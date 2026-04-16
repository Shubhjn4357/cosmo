"""
Vision Training Dataset Loader
Loads image-text pairs from HuggingFace dataset for vision model training
"""

import json
from typing import Optional, Dict, Any
import torch
from torch.utils.data import Dataset
from PIL import Image
import requests
from io import BytesIO
from loguru import logger
import hashlib
from pathlib import Path
from utils.app_paths import DATA_ROOT, UPLOADS_DIR

try:
    from datasets import load_dataset

    DATASETS_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    load_dataset = None
    DATASETS_AVAILABLE = False

try:
    from torchvision import transforms

    TORCHVISION_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    transforms = None
    TORCHVISION_AVAILABLE = False

try:
    from services.curated_training_import import CURATED_VISION_DIR
except Exception:  # pragma: no cover - fallback for standalone usage
    CURATED_VISION_DIR = Path("data/datasets/curated/vision")


class VisionTrainingDataset(Dataset):
    """
    Dataset for training vision generation models
    Loads image-text pairs from HuggingFace dataset
    """
    
    def __init__(
        self,
        dataset_name: str = "shubhjn/cosmo-data",
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
        self.local_records: list[Dict[str, Any]] = []
        
        logger.info(f"Loading dataset: {dataset_name} ({split})")

        if DATASETS_AVAILABLE:
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
        else:
            logger.warning("datasets package is unavailable; using only local imported vision records")
            self.dataset = []

        self.local_records = self._load_local_records()
        self.feed_records = self._load_feed_records()
        
        self.remote_samples = len(self.dataset)
        self.local_samples = len(self.local_records)
        self.feed_samples = len(self.feed_records)
        
        self.total_samples = self.remote_samples + self.local_samples + self.feed_samples
        if max_samples is not None:
            self.total_samples = min(self.total_samples, max_samples)
        logger.info(
            "Vision dataset ready: remote={} local={} feed={} total={}",
            self.remote_samples,
            self.local_samples,
            self.feed_samples,
            self.total_samples,
        )
        
        # Image preprocessing
        if TORCHVISION_AVAILABLE:
            self.transform = transforms.Compose([
                transforms.Resize((image_size, image_size)),
                transforms.ToTensor(),
                transforms.Lambda(lambda x: x * 2 - 1)  # Normalize to [-1, 1]
            ])
        else:
            logger.warning("torchvision is unavailable; using fallback PIL image transform")
            self.transform = self._fallback_transform
    
    def __len__(self) -> int:
        return self.total_samples

    def _load_local_records(self) -> list[Dict[str, Any]]:
        records: list[Dict[str, Any]] = []
        if not CURATED_VISION_DIR.exists():
            return records

        for path in sorted(CURATED_VISION_DIR.glob("*.jsonl")):
            try:
                with path.open("r", encoding="utf-8") as handle:
                    for line in handle:
                        if not line.strip():
                            continue
                        payload = json.loads(line)
                        if not isinstance(payload, dict):
                            continue
                        image_ref = payload.get("image_path") or payload.get("image_url") or payload.get("image")
                        text = str(payload.get("text") or payload.get("prompt") or "").strip()
                        if not image_ref or not text:
                            continue
                        records.append(payload)
            except Exception as exc:
                logger.warning(f"Failed to load local vision file {path}: {exc}")
        return records

    def _load_feed_records(self) -> list[Dict[str, Any]]:
        """Loads records from the dynamic environmental feed."""
        records: list[Dict[str, Any]] = []
        feed_path = DATA_ROOT / "vision" / "feed.jsonl"
        if not feed_path.exists():
            return records
            
        try:
            with feed_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip(): continue
                    payload = json.loads(line)
                    # Convert preview_url to local path if possible
                    preview_url = payload.get("preview_url")
                    if preview_url and preview_url.startswith("/static/vision-feed/"):
                        filename = preview_url.split("/")[-1]
                        local_path = UPLOADS_DIR / "vision-feed" / filename
                        if local_path.exists():
                            payload["image_path"] = str(local_path)
                    
                    records.append(payload)
        except Exception as exc:
            logger.warning(f"Failed to load feed vision file {feed_path}: {exc}")
        return records

    def _fallback_transform(self, image: Image.Image) -> torch.Tensor:
        image = image.convert('RGB').resize((self.image_size, self.image_size))
        tensor = torch.tensor(list(image.getdata()), dtype=torch.float32)
        tensor = tensor.view(self.image_size, self.image_size, 3).permute(2, 0, 1) / 255.0
        return tensor * 2 - 1
    
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

    def _load_local_image(self, path_value: str) -> Optional[torch.Tensor]:
        try:
            image = Image.open(Path(path_value)).convert('RGB')
            return self.transform(image)
        except Exception as e:
            logger.warning(f"Failed to load local image from {path_value}: {e}")
            return None
    
    def __getitem__(self, idx: int) -> Optional[Dict[str, Any]]:
        """
        Get training sample
        
        Args:
            idx: Sample index
            
        Returns:
            Dictionary with 'text', 'image', 'metadata' or None if failed
        """
        if idx < len(self.dataset):
            item = self.dataset[idx]
        elif idx < len(self.dataset) + len(self.local_records):
            item = self.local_records[idx - len(self.dataset)]
        else:
            item = self.feed_records[idx - len(self.dataset) - len(self.local_records)]
        
        try:
            # Get text prompt
            text = item.get('text') or item.get('prompt') or item.get('caption') or ""
            
            # Get image
            image_source = item.get('image_url') or item.get('image_path') or item.get('image')

            if isinstance(image_source, str):
                if image_source.startswith(('http://', 'https://')):
                    image_tensor = self._download_image(image_source)
                else:
                    image_tensor = self._load_local_image(image_source)
            elif isinstance(image_source, dict):
                image_tensor = None
                if image_source.get('url'):
                    image_tensor = self._download_image(str(image_source['url']))
                elif image_source.get('path'):
                    image_tensor = self._load_local_image(str(image_source['path']))
            elif hasattr(image_source, 'convert'):
                # PIL Image
                image_tensor = self.transform(image_source)
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
            'total_samples': self.total_samples,
            'remote_samples': self.remote_samples,
            'local_samples': len(self.local_records),
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
