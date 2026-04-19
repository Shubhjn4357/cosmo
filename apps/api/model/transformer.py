"""
Cosmo AI - Micro-Transformer Architecture
Optimized for 4GB RAM systems with memory-efficient design
"""

import math
import torch  # type: ignore
import torch.nn as nn  # type: ignore
import torch.nn.functional as F  # type: ignore
from typing import Optional, Tuple
from dataclasses import dataclass


@dataclass
class TransformerConfig:
    """Configuration for the Micro-Transformer model."""
    vocab_size: int = 16384
    d_model: int = 256
    n_heads: int = 4
    n_layers: int = 4
    d_ff: int = 512
    max_seq_len: int = 512
    dropout: float = 0.1
    layer_norm_eps: float = 1e-6
    
    @classmethod
    def from_dict(cls, config_dict: dict) -> "TransformerConfig":
        return cls(**{k: v for k, v in config_dict.items() if k in cls.__dataclass_fields__})


class RotaryPositionalEmbedding(nn.Module):
    """Rotary Position Embedding (RoPE) for better position-aware attention."""
    
    def __init__(self, dim: int, max_seq_len: int = 512, base: int = 10000):
        super().__init__()
        self.dim = dim
        self.max_seq_len = max_seq_len
        self.base = base
        
        # Precompute frequencies
        inv_freq = 1.0 / (base ** (torch.arange(0, dim, 2).float() / dim))
        self.register_buffer("inv_freq", inv_freq)
        
        # Precompute cos and sin for all positions
        self._build_cache(max_seq_len)
    
    def _build_cache(self, seq_len: int):
        positions = torch.arange(seq_len).float()
        freqs = torch.outer(positions, self.inv_freq)
        emb = torch.cat([freqs, freqs], dim=-1)
        self.register_buffer("cos_cache", emb.cos())
        self.register_buffer("sin_cache", emb.sin())
    
    def forward(self, x: torch.Tensor, seq_len: int) -> Tuple[torch.Tensor, torch.Tensor]:
        return self.cos_cache[:seq_len], self.sin_cache[:seq_len]


def rotate_half(x: torch.Tensor) -> torch.Tensor:
    """Rotate half the hidden dims of the input."""
    x1 = x[..., : x.shape[-1] // 2]
    x2 = x[..., x.shape[-1] // 2 :]
    return torch.cat([-x2, x1], dim=-1)


def apply_rotary_pos_emb(q: torch.Tensor, k: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
    """Apply rotary position embedding to query and key tensors."""
    q_embed = (q * cos) + (rotate_half(q) * sin)
    k_embed = (k * cos) + (rotate_half(k) * sin)
    return q_embed, k_embed


class MultiHeadAttention(nn.Module):
    """Multi-Head Self-Attention with RoPE and memory efficiency."""
    
    def __init__(self, config: TransformerConfig):
        super().__init__()
        self.config = config
        self.n_heads = config.n_heads
        self.head_dim = config.d_model // config.n_heads
        self.scale = self.head_dim ** -0.5
        
        # Combined QKV projection for efficiency
        self.qkv_proj = nn.Linear(config.d_model, 3 * config.d_model, bias=False)
        self.out_proj = nn.Linear(config.d_model, config.d_model, bias=False)
        
        self.dropout = nn.Dropout(config.dropout)
        self.rope = RotaryPositionalEmbedding(self.head_dim, config.max_seq_len)
    
    def forward(
        self,
        x: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
        use_cache: bool = False,
        cache: Optional[Tuple[torch.Tensor, torch.Tensor]] = None
    ) -> Tuple[torch.Tensor, Optional[Tuple[torch.Tensor, torch.Tensor]]]:
        batch_size, seq_len, _ = x.shape
        
        # Combined QKV projection
        qkv = self.qkv_proj(x)
        qkv = qkv.reshape(batch_size, seq_len, 3, self.n_heads, self.head_dim)
        qkv = qkv.permute(2, 0, 3, 1, 4)  # (3, B, H, S, D)
        q, k, v = qkv[0], qkv[1], qkv[2]
        
        # Apply RoPE
        cos, sin = self.rope(q, seq_len)
        q, k = apply_rotary_pos_emb(q, k, cos.unsqueeze(0).unsqueeze(0), sin.unsqueeze(0).unsqueeze(0))
        
        # Handle KV cache for inference
        if cache is not None:
            k_cache, v_cache = cache
            k = torch.cat([k_cache, k], dim=2)
            v = torch.cat([v_cache, v], dim=2)
        
        new_cache = (k, v) if use_cache else None
        
        # Scaled dot-product attention
        attn_weights = torch.matmul(q, k.transpose(-2, -1)) * self.scale
        
        if mask is not None:
            attn_weights = attn_weights.masked_fill(mask == 0, float('-inf'))
        
        attn_weights = F.softmax(attn_weights, dim=-1)
        attn_weights = self.dropout(attn_weights)
        
        attn_output = torch.matmul(attn_weights, v)
        attn_output = attn_output.transpose(1, 2).reshape(batch_size, seq_len, -1)
        
        return self.out_proj(attn_output), new_cache


class FeedForward(nn.Module):
    """SwiGLU Feed-Forward Network for better performance."""
    
    def __init__(self, config: TransformerConfig):
        super().__init__()
        self.w1 = nn.Linear(config.d_model, config.d_ff, bias=False)
        self.w2 = nn.Linear(config.d_ff, config.d_model, bias=False)
        self.w3 = nn.Linear(config.d_model, config.d_ff, bias=False)
        self.dropout = nn.Dropout(config.dropout)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # SwiGLU activation
        return self.dropout(self.w2(F.silu(self.w1(x)) * self.w3(x)))


class TransformerBlock(nn.Module):
    """Single Transformer block with pre-norm architecture."""
    
    def __init__(self, config: TransformerConfig):
        super().__init__()
        self.attention = MultiHeadAttention(config)
        self.feed_forward = FeedForward(config)
        self.attention_norm = nn.RMSNorm(config.d_model, eps=config.layer_norm_eps)
        self.ffn_norm = nn.RMSNorm(config.d_model, eps=config.layer_norm_eps)
    
    def forward(
        self,
        x: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
        use_cache: bool = False,
        cache: Optional[Tuple[torch.Tensor, torch.Tensor]] = None
    ) -> Tuple[torch.Tensor, Optional[Tuple[torch.Tensor, torch.Tensor]]]:
        # Pre-norm attention
        residual = x
        x = self.attention_norm(x)
        x, new_cache = self.attention(x, mask, use_cache, cache)
        x = residual + x
        
        # Pre-norm feed-forward
        residual = x
        x = self.ffn_norm(x)
        x = residual + self.feed_forward(x)
        
        return x, new_cache


class MicroTransformer(nn.Module):
    """
    Micro-Transformer: A lightweight language model optimized for low-memory systems.
    
    Features:
    - RoPE positional embeddings
    - SwiGLU activation
    - RMSNorm for stability
    - KV-cache for efficient generation
    """
    
    def __init__(self, config: TransformerConfig):
        super().__init__()
        self.config = config
        
        # Token embeddings
        self.token_embedding = nn.Embedding(config.vocab_size, config.d_model)
        self.dropout = nn.Dropout(config.dropout)
        
        # Transformer layers
        self.layers = nn.ModuleList([
            TransformerBlock(config) for _ in range(config.n_layers)
        ])
        
        # Output
        self.norm = nn.RMSNorm(config.d_model, eps=config.layer_norm_eps)
        self.lm_head = nn.Linear(config.d_model, config.vocab_size, bias=False)
        
        # Weight tying
        self.lm_head.weight = self.token_embedding.weight
        
        # Initialize weights
        self.apply(self._init_weights)
    
    def _init_weights(self, module: nn.Module):
        if isinstance(module, nn.Linear):
            torch.nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                torch.nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            torch.nn.init.normal_(module.weight, mean=0.0, std=0.02)
    
    def _create_causal_mask(self, seq_len: int, device: torch.device) -> torch.Tensor:
        """Create causal attention mask."""
        mask = torch.tril(torch.ones(seq_len, seq_len, device=device))
        return mask
    
    def forward(
        self,
        input_ids: torch.Tensor,
        labels: Optional[torch.Tensor] = None,
        use_cache: bool = False,
        past_key_values: Optional[list] = None
    ) -> dict:
        batch_size, seq_len = input_ids.shape
        device = input_ids.device
        
        # Token embeddings
        x = self.token_embedding(input_ids)
        x = self.dropout(x)
        
        # Causal mask
        mask = self._create_causal_mask(seq_len, device)
        
        # Process through layers
        new_cache = []
        for i, layer in enumerate(self.layers):
            layer_cache = past_key_values[i] if past_key_values else None
            x, cache = layer(x, mask, use_cache, layer_cache)
            if use_cache:
                new_cache.append(cache)
        
        # Output projection
        x = self.norm(x)
        logits = self.lm_head(x)
        
        # Calculate loss if labels provided
        loss = None
        if labels is not None:
            shift_logits = logits[..., :-1, :].contiguous()
            shift_labels = labels[..., 1:].contiguous()
            loss = F.cross_entropy(
                shift_logits.view(-1, self.config.vocab_size),
                shift_labels.view(-1),
                ignore_index=-100
            )
        
        return {
            "logits": logits,
            "loss": loss,
            "past_key_values": new_cache if use_cache else None
        }
    
    @torch.no_grad()
    def generate(
        self,
        input_ids: torch.Tensor,
        max_new_tokens: int = 100,
        temperature: float = 0.8,
        top_k: int = 50,
        top_p: float = 0.9,
        stop_tokens: Optional[list] = None
    ) -> torch.Tensor:
        """
        Generate tokens autoregressively with KV-cache.
        
        Args:
            input_ids: Starting token IDs
            max_new_tokens: Maximum new tokens to generate
            temperature: Sampling temperature (higher = more random)
            top_k: Keep only top-k logits for sampling
            top_p: Nucleus sampling threshold
            stop_tokens: List of token IDs that stop generation
        
        Returns:
            Generated token IDs including input
        """
        self.eval()
        device = input_ids.device
        stop_tokens = stop_tokens or []
        
        # Initial forward pass
        past_key_values = None
        
        for _ in range(max_new_tokens):
            # Forward pass (with cache)
            if past_key_values is None:
                outputs = self(input_ids, use_cache=True)
            else:
                outputs = self(input_ids[:, -1:], use_cache=True, past_key_values=past_key_values)
            
            past_key_values = outputs["past_key_values"]
            logits = outputs["logits"][:, -1, :]
            
            # Apply temperature
            if temperature > 0:
                logits = logits / temperature
            
            # Top-k filtering
            if top_k > 0:
                indices_to_remove = logits < torch.topk(logits, top_k)[0][..., -1, None]
                logits[indices_to_remove] = float('-inf')
            
            # Top-p (nucleus) filtering
            if top_p < 1.0:
                sorted_logits, sorted_indices = torch.sort(logits, descending=True)
                cumulative_probs = torch.cumsum(F.softmax(sorted_logits, dim=-1), dim=-1)
                
                sorted_indices_to_remove = cumulative_probs > top_p
                sorted_indices_to_remove[..., 1:] = sorted_indices_to_remove[..., :-1].clone()
                sorted_indices_to_remove[..., 0] = 0
                
                indices_to_remove = sorted_indices_to_remove.scatter(1, sorted_indices, sorted_indices_to_remove)
                logits[indices_to_remove] = float('-inf')
            
            # Sample
            probs = F.softmax(logits, dim=-1)
            next_token = torch.multinomial(probs, num_samples=1)
            
            # Append to sequence
            input_ids = torch.cat([input_ids, next_token], dim=-1)
            
            # Check for stop tokens
            if next_token.item() in stop_tokens:
                break
        
        return input_ids
    
    def count_parameters(self) -> int:
        """Count total trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
    
    def save(self, path: str):
        """Save model checkpoint."""
        torch.save({
            "config": self.config.__dict__,
            "state_dict": self.state_dict()
        }, path)
    
    @classmethod
    def load(cls, path: str, device: str = "cpu") -> "MicroTransformer":
        """Load model from checkpoint."""
        checkpoint = torch.load(path, map_location=device)
        config = TransformerConfig(**checkpoint["config"])
        model = cls(config)
        model.load_state_dict(checkpoint["state_dict"])
        return model


def create_model(config_dict: dict) -> MicroTransformer:
    """Factory function to create a model from config dictionary."""
    config = TransformerConfig.from_dict(config_dict)
    model = MicroTransformer(config)
    print(f"Created MicroTransformer with {model.count_parameters():,} parameters")
    return model
