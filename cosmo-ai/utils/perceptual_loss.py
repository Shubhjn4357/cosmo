"""
Perceptual Loss for Vision Training
Uses VGG features for perceptual similarity
"""

import torch
import torch.nn as nn
import torchvision.models as models
from torchvision.models import VGG16_Weights


class PerceptualLoss(nn.Module):
    """
    Perceptual loss using VGG16 features
    Compares high-level features rather than pixels
    """
    
    def __init__(self, layers=None, device='cpu'):
        """
        Initialize perceptual loss
        
        Args:
            layers: List of VGG layer indices to use (default: [3, 8, 15, 22])
            device: Device to run on
        """
        super().__init__()
        
        # Default layers: relu1_2, relu2_2, relu3_3, relu4_3
        self.layers = layers or [3, 8, 15, 22]
        self.device = device
        
        # Load pretrained VGG16
        vgg = models.vgg16(weights=VGG16_Weights.IMAGENET1K_V1).features
        vgg = vgg.to(device).eval()
        
        # Freeze parameters
        for param in vgg.parameters():
            param.requires_grad = False
        
        # Extract feature layers
        self.feature_layers = []
        for i in self.layers:
            self.feature_layers.append(vgg[:i+1])
        
        # Normalization (ImageNet stats)
        self.register_buffer('mean', torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer('std', torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
        
        self.mse = nn.MSELoss()
    
    def normalize(self, x):
        """Normalize images to ImageNet stats"""
        # Input is in [-1, 1], convert to [0, 1] first
        x = (x + 1) / 2
        return (x - self.mean) / self.std
    
    def forward(self, generated, target):
        """
        Calculate perceptual loss
        
        Args:
            generated: Generated images [B, 3, H, W] in [-1, 1]
            target: Target images [B, 3, H, W] in [-1, 1]
            
        Returns:
            Perceptual loss value
        """
        # Normalize inputs
        generated = self.normalize(generated)
        target = self.normalize(target)
        
        loss = 0.0
        
        # Calculate loss for each layer
        for layer in self.feature_layers:
            gen_features = layer(generated)
            target_features = layer(target)
            loss += self.mse(gen_features, target_features)
        
        # Average across layers
        return loss / len(self.feature_layers)


class CombinedLoss(nn.Module):
    """
    Combined loss for vision training
    MSE + Perceptual + optional L1
    """
    
    def __init__(
        self,
        mse_weight=1.0,
        perceptual_weight=0.1,
        l1_weight=0.0,
        device='cpu'
    ):
        """
        Initialize combined loss
        
        Args:
            mse_weight: Weight for pixel-wise MSE loss
            perceptual_weight: Weight for perceptual loss
            l1_weight: Weight for L1 loss (optional)
            device: Device to run on
        """
        super().__init__()
        
        self.mse_weight = mse_weight
        self.perceptual_weight = perceptual_weight
        self.l1_weight = l1_weight
        
        self.mse = nn.MSELoss()
        self.l1 = nn.L1Loss()
        self.perceptual = PerceptualLoss(device=device) if perceptual_weight > 0 else None
    
    def forward(self, generated, target):
        """
        Calculate combined loss
        
        Args:
            generated: Generated images [B, 3, H, W]
            target: Target images [B, 3, H, W]
            
        Returns:
            Dictionary with total loss and individual components
        """
        losses = {}
        
        # MSE loss (pixel-wise)
        if self.mse_weight > 0:
            losses['mse'] = self.mse(generated, target) * self.mse_weight
        
        # L1 loss
        if self.l1_weight > 0:
            losses['l1'] = self.l1(generated, target) * self.l1_weight
        
        # Perceptual loss
        if self.perceptual_weight > 0 and self.perceptual is not None:
            losses['perceptual'] = self.perceptual(generated, target) * self.perceptual_weight
        
        # Total loss
        losses['total'] = sum(losses.values())
        
        return losses


# Simple testing
if __name__ == "__main__":
    # Test perceptual loss
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    
    loss_fn = CombinedLoss(
        mse_weight=1.0,
        perceptual_weight=0.1,
        device=device
    )
    
    # Random images
    generated = torch.randn(4, 3, 64, 64).to(device)
    target = torch.randn(4, 3, 64, 64).to(device)
    
    losses = loss_fn(generated, target)
    
    print("Loss components:")
    for name, value in losses.items():
        print(f"  {name}: {value.item():.4f}")
