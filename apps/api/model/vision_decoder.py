"""
Vision Decoder Extension for Micro-Transformer
Adds basic image generation capability (experimental)
"""

import torch  # type: ignore
import torch.nn as nn  # type: ignore
import torch.nn.functional as F  # type: ignore
from typing import Optional


class VisionDecoder(nn.Module):
    """
    Simple vision decoder that converts text embeddings to images
    Very basic implementation - won't produce good results initially
    Learns gradually from vision feed data
    """
    
    def __init__(
        self,
        d_model: int = 256,
        image_size: int = 64,  # Start small (64x64)
        image_channels: int = 3,
        hidden_dim: int = 512
    ):
        super().__init__()
        self.d_model = d_model
        self.image_size = image_size
        self.image_channels = image_channels
        
        # Project text embedding to spatial features
        self.embed_to_spatial = nn.Sequential(
            nn.Linear(d_model, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 16 * 16 * 128),  # 16x16 feature map
        )
        
        # Upsampling decoder (simple ConvTranspose)
        self.decoder = nn.Sequential(
            # 16x16 -> 32x32
            nn.ConvTranspose2d(128, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            
            # 32x32 -> 64x64
            nn.ConvTranspose2d(64, 32, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            
            # Final layer
            nn.Conv2d(32, image_channels, kernel_size=3, padding=1),
            nn.Tanh()  # Output in [-1, 1]
        )
        
    def forward(self, text_embedding: torch.Tensor) -> torch.Tensor:
        """
        Generate image from text embedding
        
        Args:
            text_embedding: [batch_size, d_model] or [batch_size, seq_len, d_model]
        
        Returns:
            Generated image [batch_size, channels, height, width]
        """
        # If sequence, use mean pooling
        if text_embedding.dim() == 3:
            text_embedding = text_embedding.mean(dim=1)  # [B, d_model]
        
        # Project to spatial
        spatial = self.embed_to_spatial(text_embedding)  # [B, 16*16*128]
        spatial = spatial.view(-1, 128, 16, 16)  # [B, 128, 16, 16]
        
        # Decode to image
        image = self.decoder(spatial)  # [B, 3, 64, 64]
        
        return image


class VisionAwareTransformer(nn.Module):
    """
    Extended transformer with vision generation capability
    Wraps MicroTransformer and adds vision decoder
    """
    
    def __init__(self, text_model, vision_decoder: Optional[VisionDecoder] = None):
        super().__init__()
        self.text_model = text_model
        self.vision_decoder = vision_decoder or VisionDecoder(d_model=text_model.config.d_model)
        
        # Projection from vision embeddings (512D from CLIP) to text model space
        self.vision_proj = nn.Linear(512, text_model.config.d_model)
        
    def forward_text(self, input_ids: torch.Tensor, **kwargs):
        """Standard text generation"""
        return self.text_model(input_ids, **kwargs)
    
    def encode_vision(self, vision_embedding: torch.Tensor) -> torch.Tensor:
        """
        Project CLIP vision embedding to model space
        
        Args:
            vision_embedding: [batch_size, 512] from CLIP
        
        Returns:
            Projected embedding [batch_size, d_model]
        """
        return self.vision_proj(vision_embedding)
    
    def generate_image(self, prompt_embedding: torch.Tensor) -> torch.Tensor:
        """
        Generate image from text embedding
        
        Args:
            prompt_embedding: [batch_size, d_model] or text from model
        
        Returns:
            Generated image [batch_size, 3, 64, 64]
        """
        return self.vision_decoder(prompt_embedding)
    
    def forward(
        self,
        input_ids: Optional[torch.Tensor] = None,
        vision_embedding: Optional[torch.Tensor] = None,
        generate_image: bool = False,
        **kwargs
    ):
        """
        Unified forward pass
        
        Args:
            input_ids: Text input
            vision_embedding: CLIP vision embedding (for learning)
            generate_image: If True, generate image from text
        """
        if input_ids is not None:
            # Text forward
            text_output = self.text_model(input_ids, **kwargs)
            
            if generate_image:
                # Get text embedding and generate image
                with torch.no_grad():
                    text_emb = self.text_model.token_embedding(input_ids)
                    text_emb = text_emb.mean(dim=1)  # Pool
                
                generated_image = self.vision_decoder(text_emb)
                text_output["generated_image"] = generated_image
            
            return text_output
        
        elif vision_embedding is not None:
            # Vision input - project and return
            projected = self.vision_proj(vision_embedding)
            return {"vision_embedding": projected}
        
        else:
            raise ValueError("Must provide either input_ids or vision_embedding")
    
    def count_parameters(self) -> dict:
        """Count parameters by component"""
        return {
            "text_model": sum(p.numel() for p in self.text_model.parameters()),
            "vision_decoder": sum(p.numel() for p in self.vision_decoder.parameters()),
            "vision_proj": sum(p.numel() for p in self.vision_proj.parameters()),
            "total": sum(p.numel() for p in self.parameters())
        }


def create_vision_aware_model(text_model, image_size: int = 64):
    """
    Create vision-aware transformer from existing text model
    
    Args:
        text_model: Existing MicroTransformer instance
        image_size: Output image size (start small, e.g., 64x64)
    
    Returns:
        VisionAwareTransformer with generation capability
    """
    vision_decoder = VisionDecoder(
        d_model=text_model.config.d_model,
        image_size=image_size
    )
    
    model = VisionAwareTransformer(text_model, vision_decoder)
    
    params = model.count_parameters()
    print(f"Vision-Aware Model Parameters:")
    print(f"  Text Model: {params['text_model']:,}")
    print(f"  Vision Decoder: {params['vision_decoder']:,}")
    print(f"  Vision Projection: {params['vision_proj']:,}")
    print(f"  Total: {params['total']:,}")
    
    return model
