"""
Vision Model Training Script
Trains vision generation model using text-to-image pairs
"""

import argparse
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from pathlib import Path
from loguru import logger
import time
from tqdm import tqdm
from typing import Optional

# Add parent directory to path
import sys
sys.path.append(str(Path(__file__).parent.parent))

from model.transformer import MicroTransformer, TransformerConfig
from model.vision_decoder import create_vision_aware_model
from model.tokenizer import CosmoTokenizer, create_pretrained_tokenizer
from training.vision_dataset import VisionTrainingDataset, create_dataloaders
from utils.perceptual_loss import CombinedLoss


class VisionTrainer:
    """Trains vision generation model"""
    
    def __init__(
        self,
        model,
        tokenizer,
        config: dict,
        device: str = 'cuda'
    ):
        """
        Initialize vision trainer
        
        Args:
            model: VisionAwareTransformer instance
            tokenizer: Tokenizer for encoding text
            config: Training configuration
            device: Device to train on
        """
        self.model = model.to(device)
        self.tokenizer = tokenizer
        self.config = config
        self.device = device
        
        # Loss function
        self.criterion = CombinedLoss(
            mse_weight=config.get('mse_weight', 1.0),
            perceptual_weight=config.get('perceptual_weight', 0.1),
            l1_weight=config.get('l1_weight', 0.0),
            device=device
        )
        
        # Optimizer
        self.optimizer = optim.AdamW(
            model.parameters(),
            lr=config.get('learning_rate', 1e-4),
            weight_decay=config.get('weight_decay', 0.01)
        )
        
        # Learning rate scheduler
        self.scheduler = optim.lr_scheduler.CosineAnnealingLR(
            self.optimizer,
            T_max=config.get('epochs', 10),
            eta_min=1e-6
        )
        
        # Metrics
        self.best_val_loss = float('inf')
        self.global_step = 0
        
        logger.info(f"VisionTrainer initialized on {device}")
    
    def train_step(self, batch):
        """
        Single training step
        
        Args:
            batch: Dictionary with 'text' and 'image'
            
        Returns:
            Dictionary of losses
        """
        texts = batch['text']
        target_images = batch['image'].to(self.device)
        
        # Encode text prompts
        encoded = self.tokenizer.encode_batch(texts, return_tensors='pt', padding=True)
        input_ids = encoded['input_ids'].to(self.device)
        
        # Get text embeddings (mean pooling)
        with torch.no_grad():
            text_emb = self.model.text_model.token_embedding(input_ids)
            text_emb = text_emb.mean(dim=1)  # [B, d_model]
        
        # Generate images
        generated = self.model.generate_image(text_emb)  # [B, 3, 64, 64]
        
        # Calculate loss
        losses = self.criterion(generated, target_images)
        
        return losses
    
    def train_epoch(self, train_loader, epoch):
        """
        Train for one epoch
        
        Args:
            train_loader: Training data loader
            epoch: Current epoch number
            
        Returns:
            Average training loss
        """
        self.model.train()
        total_loss = 0.0
        num_batches = 0
        
        pbar = tqdm(train_loader, desc=f"Epoch {epoch}")
        
        for batch in pbar:
            if batch is None:  # Skip failed batches
                continue
            
            # Forward pass
            losses = self.train_step(batch)
            loss = losses['total']
            
            # Backward pass
            self.optimizer.zero_grad()
            loss.backward()
            
            # Gradient clipping
            torch.nn.utils.clip_grad_norm_(
                self.model.parameters(),
                self.config.get('grad_clip', 1.0)
            )
            
            self.optimizer.step()
            
            # Update metrics
            total_loss += loss.item()
            num_batches += 1
            self.global_step += 1
            
            # Update progress bar
            pbar.set_postfix({
                'loss': f"{loss.item():.4f}",
                'mse': f"{losses.get('mse', 0):.4f}",
                'percep': f"{losses.get('perceptual', 0):.4f}"
            })
        
        return total_loss / max(num_batches, 1)
    
    @torch.no_grad()
    def validate(self, val_loader):
        """
        Validate model
        
        Args:
            val_loader: Validation data loader
            
        Returns:
            Average validation loss
        """
        self.model.eval()
        total_loss = 0.0
        num_batches = 0
        
        for batch in val_loader:
            if batch is None:
                continue
            
            losses = self.train_step(batch)
            total_loss += losses['total'].item()
            num_batches += 1
        
        return total_loss / max(num_batches, 1)
    
    def save_checkpoint(self, path: str, epoch: int, val_loss: float):
        """Save model checkpoint"""
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'scheduler_state_dict': self.scheduler.state_dict(),
            'val_loss': val_loss,
            'global_step': self.global_step,
            'config': self.config
        }
        
        torch.save(checkpoint, path)
        logger.info(f"Saved checkpoint to {path}")
    
    def load_checkpoint(self, path: str):
        """Load model checkpoint"""
        checkpoint = torch.load(path, map_location=self.device)
        
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.scheduler.load_state_dict(checkpoint['scheduler_state_dict'])
        self.global_step = checkpoint['global_step']
        
        logger.info(f"Loaded checkpoint from {path}")
        return checkpoint['epoch']
    
    def train(
        self,
        train_loader,
        val_loader,
        epochs: int,
        checkpoint_dir: str = "checkpoints",
        resume_from: Optional[str] = None
    ):
        """
        Full training loop
        
        Args:
            train_loader: Training data loader
            val_loader: Validation data loader
            epochs: Number of epochs to train
            checkpoint_dir: Directory to save checkpoints
            resume_from: Optional checkpoint to resume from
        """
        checkpoint_path = Path(checkpoint_dir)
        checkpoint_path.mkdir(parents=True, exist_ok=True)
        
        start_epoch = 0
        if resume_from:
            start_epoch = self.load_checkpoint(resume_from)
        
        logger.info(f"Training for {epochs} epochs")
        
        for epoch in range(start_epoch, epochs):
            # Train
            train_loss = self.train_epoch(train_loader, epoch)
            
            # Validate
            val_loss = self.validate(val_loader)
            
            # Update scheduler
            self.scheduler.step()
            
            # Log
            logger.info(
                f"Epoch {epoch}: "
                f"train_loss={train_loss:.4f}, "
                f"val_loss={val_loss:.4f}, "
                f"lr={self.scheduler.get_last_lr()[0]:.6f}"
            )
            
            # Save checkpoint
            if val_loss < self.best_val_loss:
                self.best_val_loss = val_loss
                self.save_checkpoint(
                    str(checkpoint_path / "best_model.pt"),
                    epoch,
                    val_loss
                )
            
            # Save latest checkpoint
            self.save_checkpoint(
                str(checkpoint_path / "latest_model.pt"),
                epoch,
                val_loss
            )
        
        logger.info(f"Training complete! Best val loss: {self.best_val_loss:.4f}")


def main():
    """Main training function"""
    parser = argparse.ArgumentParser(description="Train Vision Generation Model")
    parser.add_argument("--dataset", default="shubhjn/cosmo-data", help="HuggingFace dataset")
    parser.add_argument("--epochs", type=int, default=10, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--image-size", type=int, default=64, help="Image size")
    parser.add_argument("--max-samples", type=int, help="Limit dataset size")
    parser.add_argument("--resume", type=str, help="Resume from checkpoint")
    parser.add_argument("--checkpoint-dir", default="checkpoints", help="Checkpoint directory")
    
    args = parser.parse_args()
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    logger.info(f"Using device: {device}")
    
    # Load tokenizer
    tokenizer_path = Path("checkpoints/tokenizer.json")
    if tokenizer_path.exists():
        tokenizer = CosmoTokenizer.load(str(tokenizer_path))
    else:
        tokenizer = create_pretrained_tokenizer()
        tokenizer_path.parent.mkdir(parents=True, exist_ok=True)
        tokenizer.save(str(tokenizer_path))
    
    # Create or load text model
    text_model_path = Path("checkpoints/latest.pt")
    if text_model_path.exists():
        logger.info("Loading existing text model")
        text_model = MicroTransformer.load(str(text_model_path), device=device)
    else:
        logger.info("Creating new text model")
        config = TransformerConfig()
        text_model = MicroTransformer(config)
    
    # Create vision-aware model
    vision_model = create_vision_aware_model(text_model, image_size=args.image_size)
    vision_model = vision_model.to(device)
    
    logger.info(f"Model parameters: {vision_model.count_parameters()}")
    
    # Load dataset
    logger.info(f"Loading dataset: {args.dataset}")
    dataset = VisionTrainingDataset(
        dataset_name=args.dataset,
        image_size=args.image_size,
        max_samples=args.max_samples
    )
    
    if len(dataset) == 0:
        logger.error("No training data available!")
        return
    
    logger.info(f"Dataset stats: {dataset.get_stats()}")
    
    # Create dataloaders
    train_loader, val_loader = create_dataloaders(
        dataset,
        batch_size=args.batch_size,
        num_workers=2
    )
    
    # Training config
    config = {
        'learning_rate': args.lr,
        'weight_decay': 0.01,
        'mse_weight': 1.0,
        'perceptual_weight': 0.1,
        'grad_clip': 1.0,
        'epochs': args.epochs
    }
    
    # Create trainer
    trainer = VisionTrainer(
        model=vision_model,
        tokenizer=tokenizer,
        config=config,
        device=device
    )
    
    # Train
    trainer.train(
        train_loader=train_loader,
        val_loader=val_loader,
        epochs=args.epochs,
        checkpoint_dir=args.checkpoint_dir,
        resume_from=args.resume
    )
    
    logger.info("Training complete!")


if __name__ == "__main__":
    main()
