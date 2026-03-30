"""
Whisper AI - Trainer
Training loop with gradient accumulation, mixed precision, and checkpointing.
Optimized for 4GB RAM systems.
"""

import os
import time
import json
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torch.amp import autocast, GradScaler
from loguru import logger


@dataclass
class TrainingConfig:
    """Training configuration."""
    batch_size: int = 1
    gradient_accumulation: int = 8
    learning_rate: float = 3e-4
    warmup_steps: int = 100
    max_steps: int = 100000
    fp16: bool = True
    checkpoint_interval: int = 1000
    checkpoint_time_interval: int = 300  # Default 5 minutes
    checkpoint_dir: str = "checkpoints"
    log_interval: int = 10
    eval_interval: int = 500
    max_grad_norm: float = 1.0
    weight_decay: float = 0.01
    
    @classmethod
    def from_dict(cls, d: dict) -> "TrainingConfig":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


class LRScheduler:
    """Learning rate scheduler with warmup and cosine decay."""
    
    def __init__(self, optimizer, warmup_steps: int, max_steps: int, min_lr_ratio: float = 0.1):
        self.optimizer = optimizer
        self.warmup_steps = warmup_steps
        self.max_steps = max_steps
        self.min_lr_ratio = min_lr_ratio
        self.base_lr = optimizer.param_groups[0]['lr']
        self.current_step = 0
    
    def step(self):
        """Update learning rate."""
        self.current_step += 1
        lr = self.get_lr()
        for param_group in self.optimizer.param_groups:
            param_group['lr'] = lr
    
    def get_lr(self) -> float:
        """Calculate current learning rate."""
        if self.current_step < self.warmup_steps:
            # Linear warmup
            return self.base_lr * self.current_step / self.warmup_steps
        else:
            # Cosine decay
            progress = (self.current_step - self.warmup_steps) / (self.max_steps - self.warmup_steps)
            progress = min(1.0, progress)
            cosine_decay = 0.5 * (1 + torch.cos(torch.tensor(progress * 3.14159)))
            return self.base_lr * (self.min_lr_ratio + (1 - self.min_lr_ratio) * cosine_decay)


class Trainer:
    """
    Whisper AI Trainer with memory-efficient training.
    
    Features:
    - Gradient accumulation for effective larger batches
    - Mixed precision (FP16) training
    - Checkpointing and resume
    - Learning from mistakes (loss tracking)
    """
    
    def __init__(
        self,
        model: nn.Module,
        config: TrainingConfig,
        train_dataset,
        eval_dataset=None,
        device: str = "auto"
    ):
        self.model = model
        self.config = config
        self.train_dataset = train_dataset
        self.eval_dataset = eval_dataset
        
        # Device setup
        if device == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)
        
        self.model = self.model.to(self.device)
        
        # Optimizer
        self.optimizer = torch.optim.AdamW(
            self.model.parameters(),
            lr=config.learning_rate,
            weight_decay=config.weight_decay,
            betas=(0.9, 0.95)
        )
        
        # Scheduler
        self.scheduler = LRScheduler(
            self.optimizer,
            config.warmup_steps,
            config.max_steps
        )
        
        # Mixed precision
        self.scaler = GradScaler() if config.fp16 and self.device.type == "cuda" else None
        self.use_amp = config.fp16 and self.device.type == "cuda"
        
        # Training state
        self.global_step = 0
        self.total_loss = 0.0
        self.loss_history = []
        self.best_loss = float('inf')
        
        # Checkpoint directory
        self.checkpoint_dir = Path(config.checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        
        # Error tracking for learning from mistakes
        self.error_log = []
        
        logger.info(f"Trainer initialized on {self.device}")
        logger.info(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")
    
    def train_step(self, batch) -> float:
        """Single training step."""
        input_ids, labels = batch
        input_ids = input_ids.to(self.device)
        labels = labels.to(self.device)
        
        # Forward pass with optional AMP
        if self.use_amp:
            with autocast(device_type='cuda'):
                outputs = self.model(input_ids, labels=labels)
                loss = outputs["loss"] / self.config.gradient_accumulation
        else:
            outputs = self.model(input_ids, labels=labels)
            loss = outputs["loss"] / self.config.gradient_accumulation
        
        # Backward pass
        if self.scaler:
            self.scaler.scale(loss).backward()
        else:
            loss.backward()
        
        return loss.item() * self.config.gradient_accumulation
    
    def train(self, resume_from: Optional[str] = None):
        """
        Main training loop.
        
        Args:
            resume_from: Path to checkpoint to resume from
        """
        if resume_from:
            self.load_checkpoint(resume_from)
        
        dataloader = DataLoader(
            self.train_dataset,
            batch_size=self.config.batch_size,
            shuffle=True,
            num_workers=0,  # Avoid memory overhead
            pin_memory=self.device.type == "cuda"
        )
        
        self.model.train()
        accumulation_step = 0
        epoch = 0
        
        logger.info(f"Starting training from step {self.global_step}")
        
        while self.global_step < self.config.max_steps:
            last_checkpoint_time = time.time()
            epoch += 1
            epoch_loss = 0.0
            epoch_steps = 0
            
            for batch in dataloader:
                loss = self.train_step(batch)
                self.total_loss += loss
                epoch_loss += loss
                accumulation_step += 1
                epoch_steps += 1
                
                # Gradient accumulation
                if accumulation_step >= self.config.gradient_accumulation:
                    # Clip gradients
                    if self.scaler:
                        self.scaler.unscale_(self.optimizer)
                    torch.nn.utils.clip_grad_norm_(
                        self.model.parameters(),
                        self.config.max_grad_norm
                    )
                    
                    # Optimizer step
                    if self.scaler:
                        self.scaler.step(self.optimizer)
                        self.scaler.update()
                    else:
                        self.optimizer.step()
                    
                    self.optimizer.zero_grad()
                    self.scheduler.step()
                    self.global_step += 1
                    accumulation_step = 0
                    
                    # Logging
                    if self.global_step % self.config.log_interval == 0:
                        avg_loss = self.total_loss / self.config.log_interval
                        lr = self.scheduler.get_lr()
                        logger.info(
                            f"Step {self.global_step} | Loss: {avg_loss:.4f} | LR: {lr:.2e}"
                        )
                        self.loss_history.append({
                            "step": self.global_step,
                            "loss": avg_loss,
                            "lr": lr
                        })
                        self.total_loss = 0.0
                    
                    # Evaluation
                    if self.eval_dataset and self.global_step % self.config.eval_interval == 0:
                        eval_loss = self.evaluate()
                        logger.info(f"Eval loss: {eval_loss:.4f}")
                        if eval_loss < self.best_loss:
                            self.best_loss = eval_loss
                            self.save_checkpoint("best")
                    
                    # Checkpointing
                    if self.global_step % self.config.checkpoint_interval == 0:
                        self.save_checkpoint(f"step_{self.global_step}")
                    
                    # Time-based checkpointing
                    current_time = time.time()
                    if current_time - last_checkpoint_time >= self.config.checkpoint_time_interval:
                        self.save_checkpoint(f"step_{self.global_step}")
                        self.save_checkpoint("latest") # Also update latest
                        last_checkpoint_time = current_time
                    
                    if self.global_step >= self.config.max_steps:
                        break
            
            avg_epoch_loss = epoch_loss / max(epoch_steps, 1)
            logger.info(f"Epoch {epoch} complete | Avg Loss: {avg_epoch_loss:.4f}")
        
        # Final checkpoint
        self.save_checkpoint("final")
        logger.info("Training complete!")
    
    @torch.no_grad()
    def evaluate(self) -> float:
        """Evaluate on evaluation dataset."""
        if self.eval_dataset is None:
            return 0.0
        
        self.model.eval()
        total_loss = 0.0
        num_batches = 0
        
        dataloader = DataLoader(
            self.eval_dataset,
            batch_size=self.config.batch_size,
            shuffle=False
        )
        
        for batch in dataloader:
            input_ids, labels = batch
            input_ids = input_ids.to(self.device)
            labels = labels.to(self.device)
            
            outputs = self.model(input_ids, labels=labels)
            total_loss += outputs["loss"].item()
            num_batches += 1
        
        self.model.train()
        return total_loss / max(num_batches, 1)
    
    def save_checkpoint(self, name: str):
        """Save training checkpoint."""
        path = self.checkpoint_dir / f"{name}.pt"
        
        checkpoint = {
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "scheduler_step": self.scheduler.current_step,
            "global_step": self.global_step,
            "best_loss": self.best_loss,
            "config": self.config.__dict__,
            "loss_history": self.loss_history[-100:]  # Keep last 100
        }
        
        if self.scaler:
            checkpoint["scaler_state_dict"] = self.scaler.state_dict()
        
        torch.save(checkpoint, path)
        logger.info(f"Checkpoint saved: {path}")
    
    def load_checkpoint(self, path: str):
        """Load training checkpoint."""
        checkpoint = torch.load(path, map_location=self.device)
        
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        self.scheduler.current_step = checkpoint["scheduler_step"]
        self.global_step = checkpoint["global_step"]
        self.best_loss = checkpoint.get("best_loss", float('inf'))
        self.loss_history = checkpoint.get("loss_history", [])
        
        if self.scaler and "scaler_state_dict" in checkpoint:
            self.scaler.load_state_dict(checkpoint["scaler_state_dict"])
        
        logger.info(f"Checkpoint loaded from step {self.global_step}")
    
    def learn_from_mistake(self, input_text: str, expected_output: str, actual_output: str):
        """
        Record a mistake for future learning.
        
        This creates a training example from user corrections.
        """
        self.error_log.append({
            "input": input_text,
            "expected": expected_output,
            "actual": actual_output,
            "timestamp": time.time()
        })
        
        # Save errors to file
        error_path = self.checkpoint_dir / "errors.jsonl"
        with open(error_path, "a") as f:
            f.write(json.dumps(self.error_log[-1]) + "\n")
        
        logger.info(f"Recorded mistake for learning. Total errors: {len(self.error_log)}")
    
    def get_training_stats(self) -> Dict[str, Any]:
        """Get current training statistics."""
        return {
            "global_step": self.global_step,
            "best_loss": self.best_loss,
            "current_lr": self.scheduler.get_lr(),
            "total_parameters": sum(p.numel() for p in self.model.parameters()),
            "device": str(self.device),
            "recent_loss": self.loss_history[-10:] if self.loss_history else []
        }
