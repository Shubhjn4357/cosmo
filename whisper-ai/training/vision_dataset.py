"""
Vision Training Dataset Loader
Loads image-text pairs from HuggingFace dataset for vision model training
"""

from typing import Optional, Dict, Any
import torch
from torch.utils.data import Dataset
from datasets import load_dataset
from PIL import Image
import requests
from io import BytesIO
from torchvision import transforms
from loguru import logger
import hashlib
from pathlib import Path


class VisionTrainingDataset(Dataset):
    """
    Dataset for training vision generation models
    Loads image-text pairs from HuggingFace dataset
    """
    
    def __init__(
        self,
        dataset_name: str = "shubhjn/whisper-trained-data",
        split: str = "train",
        image_size: int = 64,
        cache_dir: Optional[str] = None,
        max_samples: Optional[int] = None
    ):
        """
        Initialize vision training dataset
        
        Args:
            dataset_name: HuggingFace dataset identifier
            split: Dataset split ('train', 'validation', 'test')
            image_size: Target image size for training
            cache_dir: Directory to cache downloaded images
            max_samples: Optional limit on dataset size
        """
        self.dataset_name = dataset_name
        self.image_size = image_size
        self.cache_dir = Path(cache_dir or "data/vision_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Loading dataset: {dataset_name} ({split})")
        
        try:
            # Load from HuggingFace
            self.dataset = load_dataset(dataset_name, split=split, trust_remote_code=True)
            
            # Limit size if specified
            if max_samples and len(self.dataset) > max_samples:
                self.dataset = self.dataset.select(range(max_samples))
                
            logger.info(f"Loaded {len(self.dataset)} samples")
            
        except Exception as e:
            logger.error(f"Failed to load dataset: {e}")
            logger.info("Creating empty dataset for testing")
            self.dataset = []
        
        # Image preprocessing
        self.transform = transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Lambda(lambda x: x * 2 - 1)  # Normalize to [-1, 1]
        ])
    
    def __len__(self) -> int:
        return len(self.dataset)
    
    def _get_cache_path(self, url: str) -> Path:
        """Get cache file path for image URL"""
        url_hash = hashlib.md5(url.encode()).hexdigest()
        return self.cache_dir / f"{url_hash}.pt"
    
    def _download_image(self, url: str) -> Optional[Image.Image]:
        """
        Download image from URL with caching
        
        Args:
            url: Image URL
            
        Returns:
            PIL Image or None if failed
        """
        # Check cache first
        cache_path = self._get_cache_path(url)
        if cache_path.exists():
            try:
                cached_tensor = torch.load(cache_path)
                return cached_tensor
            except:
                logger.warning(f"Cache corrupted for {url}, re-downloading")
        
        # Download image
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            image = Image.open(BytesIO(response.content)).convert('RGB')
            
            # Transform and cache
            image_tensor = self.transform(image)
            torch.save(image_tensor, cache_path)
            
            return image_tensor
            
        except Exception as e:
            logger.warning(f"Failed to download image from {url}: {e}")
            return None
    
    def __getitem__(self, idx: int) -> Optional[Dict[str, Any]]:
        """
        Get training sample
        
        Args:
            idx: Sample index
            
        Returns:
            Dictionary with 'text', 'image', 'metadata' or None if failed
        """
        if idx >= len(self.dataset):
            return None
        
        try:
            item = self.dataset[idx]
            
            # Get text prompt
            text = item.get('text') or item.get('prompt') or ""
            
            # Get image
            image_url = item.get('image_url') or item.get('image')
            
            if isinstance(image_url, str):
                # URL - download
                image_tensor = self._download_image(image_url)
            elif hasattr(image_url, 'convert'):
                # PIL Image
                image_tensor = self.transform(image_url)
            else:
                logger.warning(f"Invalid image format at index {idx}")
                return None
            
            if image_tensor is None:
                return None
            
            # Get metadata
            metadata = item.get('metadata', {})
            
            return {
                'text': text,
                'image': image_tensor,  # [3, H, W] in range [-1, 1]
                'metadata': metadata
            }
            
        except Exception as e:
            logger.error(f"Error loading sample {idx}: {e}")
            return None
    
    def get_stats(self) -> Dict[str, Any]:
        """Get dataset statistics"""
        return {
            'total_samples': len(self.dataset),
            'image_size': self.image_size,
            'cache_dir': str(self.cache_dir),
            'cached_images': len(list(self.cache_dir.glob('*.pt')))
        }


def create_dataloaders(
    dataset: VisionTrainingDataset,
    batch_size: int = 32,
    train_split: float = 0.9,
    num_workers: int = 4
):
    """
    Create train and validation dataloaders
    
    Args:
        dataset: VisionTrainingDataset instance
        batch_size: Batch size for training
        train_split: Fraction of data for training
        num_workers: Number of worker processes
        
    Returns:
        Tuple of (train_loader, val_loader)
    """
    from torch.utils.data import DataLoader, random_split
    
    # Split dataset
    train_size = int(len(dataset) * train_split)
    val_size = len(dataset) - train_size
    
    train_dataset, val_dataset = random_split(
        dataset, 
        [train_size, val_size],
        generator=torch.Generator().manual_seed(42)
    )
    
    # Custom collate function to filter None samples
    def collate_fn(batch):
        batch = [item for item in batch if item is not None]
        if len(batch) == 0:
            return None
        
        texts = [item['text'] for item in batch]
        images = torch.stack([item['image'] for item in batch])
        metadata = [item['metadata'] for item in batch]
        
        return {
            'text': texts,
            'image': images,
            'metadata': metadata
        }
    
    # Create loaders
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        collate_fn=collate_fn,
        pin_memory=True
    )
    
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        collate_fn=collate_fn,
        pin_memory=True
    )
    
    return train_loader, val_loader


# Testing utility
if __name__ == "__main__":
    # Test dataset loading
    dataset = VisionTrainingDataset(max_samples=10)
    
    print(f"Dataset size: {len(dataset)}")
    print(f"Stats: {dataset.get_stats()}")
    
    # Test loading a sample
    if len(dataset) > 0:
        sample = dataset[0]
        if sample:
            print(f"\nSample 0:")
            print(f"  Text: {sample['text'][:100]}...")
            print(f"  Image shape: {sample['image'].shape}")
            print(f"  Image range: [{sample['image'].min():.2f}, {sample['image'].max():.2f}]")
