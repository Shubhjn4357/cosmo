"""
Vision Training API Endpoints
Control and monitor vision model training
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
from loguru import logger
from pathlib import Path
import asyncio
import torch

router = APIRouter(prefix="/api/vision", tags=["vision-training"])

# Global training state
training_state = {
    "is_training": False,
    "progress": 0.0,
    "current_epoch": 0,
    "total_epochs": 0,
    "train_loss": 0.0,
    "val_loss": 0.0,
    "best_val_loss": float('inf'),
    "status": "idle",
    "error": None
}

# Auto-training configuration
auto_training_config = {
    "enabled": True,
    "delay_hours": 1.0,
    "auto_started": False,
    "scheduled_time": None
}


class TrainingConfig(BaseModel):
    """Configuration for starting training"""
    epochs: int = 10
    batch_size: int = 32
    learning_rate: float = 1e-4
    image_size: int = 64
    max_samples: Optional[int] = None
    dataset: str = "shubhjn/whisper-trained-data"


@router.post("/train/start")
async def start_training(
    config: TrainingConfig,
    background_tasks: BackgroundTasks
):
    """
    Start vision model training
    
    Args:
        config: Training configuration
        background_tasks: FastAPI background tasks
        
    Returns:
        Training status
    """
    if training_state["is_training"]:
        raise HTTPException(status_code=400, detail="Training already in progress")
    
    # Reset state
    training_state["is_training"] = True
    training_state["total_epochs"] = config.epochs
    training_state["current_epoch"] = 0
    training_state["status"] = "initializing"
    training_state["error"] = None
    
    # Start training in background
    background_tasks.add_task(run_training, config)
    
    logger.info(f"Starting vision training: {config.epochs} epochs")
    
    return {
        "status": "started",
        "config": config.dict(),
        "message": "Training started in background"
    }


@router.get("/train/status")
async def get_training_status():
    """
    Get current training status
    
    Returns:
        Training state dictionary
    """
    return training_state


@router.post("/train/stop")
async def stop_training():
    """
    Stop ongoing training
    
    Returns:
        Stop confirmation
    """
    if not training_state["is_training"]:
        raise HTTPException(status_code=400, detail="No training in progress")
    
    training_state["status"] = "stopping"
    training_state["is_training"] = False
    
    logger.info("Stopping training...")
    
    return {
        "status": "stopped",
        "message": "Training will stop after current epoch"
    }


@router.get("/model/stats")
async def get_model_stats():
    """
    Get trained model statistics
    
    Returns:
        Model statistics
    """
    model_path = Path("checkpoints/best_model.pt")
    
    stats = {
        "model_exists": model_path.exists(),
        "model_path": str(model_path) if model_path.exists() else None,
        "model_size_mb": None,
        "last_trained": None
    }
    
    if model_path.exists():
        # Get file size
        stats["model_size_mb"] = round(model_path.stat().st_size / (1024 * 1024), 2)
        
        # Get modification time
        import datetime
        mod_time = datetime.datetime.fromtimestamp(model_path.stat().st_mtime)
        stats["last_trained"] = mod_time.isoformat()
        
        # Try to load and get parameter count
        try:
            checkpoint = torch.load(model_path, map_location='cpu')
            if 'config' in checkpoint:
                stats["config"] = checkpoint['config']
            if 'val_loss' in checkpoint:
                stats["best_val_loss"] = float(checkpoint['val_loss'])
        except Exception as e:
            logger.warning(f"Could not load checkpoint: {e}")
    
    return stats


@router.get("/model/download")
async def download_model():
    """
    Download trained model file
    
    Returns:
        Model file
    """
    from fastapi.responses import FileResponse
    
    model_path = Path("checkpoints/best_model.pt")
    
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Trained model not found")
    
    return FileResponse(
        path=str(model_path),
        media_type="application/octet-stream",
        filename="vision_model.pt"
    )


@router.post("/model/reload")
async def reload_model():
    """
    Reload trained model in hybrid vision system
    
    Returns:
        Reload confirmation
    """
    try:
        from model.hybrid_vision import get_hybrid_model
        
        # Get hybrid model instance
        hybrid_model = get_hybrid_model()
        
        # Reload trained model
        hybrid_model._load_trained_model()
        
        return {
            "status": "success",
            "message": "Model reloaded",
            "model_available": hybrid_model.trained_model is not None
        }
    except Exception as e:
        logger.error(f"Error reloading model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def run_training(config: TrainingConfig):
    """
    Background task to run training
    
    Args:
        config: Training configuration
    """
    try:
        training_state["status"] = "loading_dataset"
        
        # Import training modules
        from training.vision_dataset import VisionTrainingDataset, create_dataloaders
        from train_vision import VisionTrainer
        from model.transformer import MicroTransformer, TransformerConfig
        from model.vision_decoder import create_vision_aware_model
        from model.tokenizer import WhisperTokenizer, create_pretrained_tokenizer
        
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        logger.info(f"Training on {device}")
        
        # Load tokenizer
        tokenizer_path = Path("checkpoints/tokenizer.json")
        if tokenizer_path.exists():
            tokenizer = WhisperTokenizer.load(str(tokenizer_path))
        else:
            tokenizer = create_pretrained_tokenizer()
            tokenizer_path.parent.mkdir(parents=True, exist_ok=True)
            tokenizer.save(str(tokenizer_path))
        
        # Load or create text model
        text_model_path = Path("checkpoints/latest.pt")
        if text_model_path.exists():
            text_model = MicroTransformer.load(str(text_model_path), device=device)
        else:
            text_config = TransformerConfig()
            text_model = MicroTransformer(text_config)
        
        # Create vision model
        vision_model = create_vision_aware_model(text_model, image_size=config.image_size)
        
        training_state["status"] = "loading_data"
        
        # Load dataset
        dataset = VisionTrainingDataset(
            dataset_name=config.dataset,
            image_size=config.image_size,
            max_samples=config.max_samples
        )
        
        if len(dataset) == 0:
            training_state["status"] = "error"
            training_state["error"] = "No training data available"
            training_state["is_training"] = False
            return
        
        logger.info(f"Dataset: {len(dataset)} samples")
        
        # Create dataloaders
        train_loader, val_loader = create_dataloaders(
            dataset,
            batch_size=config.batch_size,
            num_workers=2
        )
        
        training_state["status"] = "training"
        
        # Training config
        train_config = {
            'learning_rate': config.learning_rate,
            'weight_decay': 0.01,
            'mse_weight': 1.0,
            'perceptual_weight': 0.1,
            'grad_clip': 1.0,
            'epochs': config.epochs
        }
        
        # Create trainer
        trainer = VisionTrainer(
            model=vision_model,
            tokenizer=tokenizer,
            config=train_config,
            device=device
        )
        
        # Training loop with status updates
        for epoch in range(config.epochs):
            if not training_state["is_training"]:
                logger.info("Training stopped by user")
                break
            
            training_state["current_epoch"] = epoch
            training_state["progress"] = epoch / config.epochs
            
            # Train epoch
            train_loss = trainer.train_epoch(train_loader, epoch)
            training_state["train_loss"] = train_loss
            
            # Validate
            val_loss = trainer.validate(val_loader)
            training_state["val_loss"] = val_loss
            
            # Update best loss
            if val_loss < training_state["best_val_loss"]:
                training_state["best_val_loss"] = val_loss
            
            # Save checkpoint
            trainer.save_checkpoint(
                "checkpoints/latest_model.pt",
                epoch,
                val_loss
            )
            
            if val_loss < trainer.best_val_loss:
                trainer.save_checkpoint(
                    "checkpoints/best_model.pt",
                    epoch,
                    val_loss
                )
        
        training_state["status"] = "completed"
        training_state["progress"] = 1.0
        
        logger.info("Training complete!")
        
    except Exception as e:
        logger.error(f"Training error: {e}")
        training_state["status"] = "error"
        training_state["error"] = str(e)
    
    finally:
        training_state["is_training"] = False


async def schedule_auto_training():
    """
    Schedule automatic training to start after delay
    Runs on server startup
    """
    import datetime
    
    if not auto_training_config["enabled"]:
        logger.info("Auto-training disabled")
        return
    
    delay_seconds = auto_training_config["delay_hours"] * 3600
    scheduled_time = datetime.datetime.now() + datetime.timedelta(seconds=delay_seconds)
    auto_training_config["scheduled_time"] = scheduled_time.isoformat()
    
    logger.info(f"🕐 Auto-training scheduled for {scheduled_time.strftime('%H:%M:%S')} ({auto_training_config['delay_hours']}h from now)")
    
    # Wait for delay
    await asyncio.sleep(delay_seconds)
    
    # Check if training is already running
    if training_state["is_training"]:
        logger.info("Training already in progress, skipping auto-start")
        return
    
    # Start training automatically
    logger.info("🚀 Starting automatic training...")
    auto_training_config["auto_started"] = True
    
    # Default auto-training config
    config = TrainingConfig(
        epochs=10,
        batch_size=32,
        learning_rate=1e-4,
        image_size=64,
        max_samples=5000,  # Start with smaller dataset
        dataset="shubhjn/whisper-trained-data"
    )
    
    # Run training
    await run_training(config)


@router.get("/train/auto-status")
async def get_auto_training_status():
    """
    Get auto-training configuration and status
    
    Returns:
        Auto-training status
    """
    return auto_training_config


@router.post("/train/auto-enable")
async def enable_auto_training(delay_hours: float = 1.0):
    """
    Enable auto-training with specified delay
    
    Args:
        delay_hours: Hours to wait before auto-training starts
        
    Returns:
        Confirmation
    """
    auto_training_config["enabled"] = True
    auto_training_config["delay_hours"] = delay_hours
    
    return {
        "status": "enabled",
        "delay_hours": delay_hours,
        "message": f"Auto-training will start {delay_hours}h after deployment"
    }


@router.post("/train/auto-disable")
async def disable_auto_training():
    """
    Disable auto-training
    
    Returns:
        Confirmation
    """
    auto_training_config["enabled"] = False
    
    return {
        "status": "disabled",
        "message": "Auto-training disabled"
    }
