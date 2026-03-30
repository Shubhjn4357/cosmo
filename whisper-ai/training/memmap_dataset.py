"""
Whisper AI - Memory-Mapped Dataset
Efficient dataset implementation using numpy memmap for 4GB RAM systems.
"""

import os
import json
import numpy as np
from pathlib import Path
from typing import List, Optional, Iterator, Tuple
from dataclasses import dataclass
import torch
from torch.utils.data import Dataset, IterableDataset


@dataclass
class MemmapConfig:
    """Configuration for memory-mapped dataset."""
    memmap_dir: str = "data/processed"
    chunk_size: int = 1000000  # 1MB chunks
    max_seq_len: int = 512
    dtype: str = "int32"


class MemmapDataset(Dataset):
    """
    Memory-mapped dataset for efficient training on low-memory systems.
    
    Features:
    - Data lives on disk, loaded on-demand
    - Supports dynamic growth (new data can be appended)
    - Efficient random access
    """
    
    def __init__(self, config: MemmapConfig, tokenizer=None):
        self.config = config
        self.tokenizer = tokenizer
        self.memmap_dir = Path(config.memmap_dir)
        self.memmap_dir.mkdir(parents=True, exist_ok=True)
        
        self.data_path = self.memmap_dir / "tokens.dat"
        self.meta_path = self.memmap_dir / "metadata.json"
        
        # Initialize or load metadata
        if self.meta_path.exists():
            self._load_metadata()
        else:
            self.metadata = {
                "total_tokens": 0,
                "num_sequences": 0,
                "seq_len": config.max_seq_len,
                "dtype": config.dtype
            }
            self._save_metadata()
        
        # Memory map the data file
        self.data = None
        self._init_memmap()
    
    def _init_memmap(self):
        """Initialize or open the memory-mapped file."""
        dtype = getattr(np, self.config.dtype)

        allocated_size = max(
            int(self.metadata.get("allocated_size", 0)),
            int(self.metadata.get("total_tokens", 0)),
            int(self.config.chunk_size),
        )

        if self.data_path.exists():
            self._ensure_file_capacity(allocated_size)
            self.data = np.memmap(
                self.data_path,
                dtype=dtype,
                mode='r+',
                shape=(allocated_size,)
            )
        else:
            # Create empty file with initial size
            initial_size = allocated_size
            self._ensure_file_capacity(initial_size)
            self.data = np.memmap(
                self.data_path,
                dtype=dtype,
                mode='w+',
                shape=(initial_size,)
            )
            self.metadata["allocated_size"] = initial_size
            self._save_metadata()

    def _ensure_file_capacity(self, size: int):
        """Ensure the backing file can store the requested token count."""
        dtype = np.dtype(getattr(np, self.config.dtype))
        target_bytes = int(size) * dtype.itemsize
        self.data_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.data_path, 'a+b') as handle:
            handle.seek(0, os.SEEK_END)
            current_bytes = handle.tell()
            if current_bytes < target_bytes:
                handle.truncate(target_bytes)
    
    def _load_metadata(self):
        """Load metadata from file."""
        with open(self.meta_path, 'r') as f:
            self.metadata = json.load(f)
    
    def _save_metadata(self):
        """Save metadata to file."""
        with open(self.meta_path, 'w') as f:
            json.dump(self.metadata, f, indent=2)
    
    def _resize_memmap(self, new_size: int):
        """Resize the memory-mapped file."""
        dtype = getattr(np, self.config.dtype)

        if self.data is not None:
            self.data.flush()
            del self.data

        self._ensure_file_capacity(new_size)
        self.data = np.memmap(
            self.data_path,
            dtype=dtype,
            mode='r+',
            shape=(new_size,)
        )
        self.metadata["allocated_size"] = new_size
        self._save_metadata()
    
    def add_tokens(self, tokens: List[int]):
        """
        Add tokens to the dataset.
        
        Args:
            tokens: List of token IDs to add
        """
        current_tokens = self.metadata["total_tokens"]
        new_tokens = len(tokens)
        total_needed = current_tokens + new_tokens
        
        # Resize if needed
        allocated = self.metadata.get("allocated_size", len(self.data))
        if total_needed > allocated:
            new_size = max(total_needed, allocated + self.config.chunk_size)
            self._resize_memmap(new_size)
        
        # Write tokens
        self.data[current_tokens:current_tokens + new_tokens] = np.array(tokens, dtype=getattr(np, self.config.dtype))
        
        # Update metadata
        self.metadata["total_tokens"] = total_needed
        self.metadata["num_sequences"] = total_needed // self.config.max_seq_len
        self._save_metadata()
        
        # Flush to disk
        self.data.flush()
    
    def add_text(self, text: str):
        """
        Tokenize and add text to the dataset.
        
        Args:
            text: Text to tokenize and add
        """
        if self.tokenizer is None:
            raise ValueError("Tokenizer required to add text")
        
        tokens = self.tokenizer.encode(text, add_special_tokens=False)
        self.add_tokens(tokens)
    
    def __len__(self) -> int:
        """Return number of complete sequences."""
        return self.metadata["num_sequences"]
    
    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Get a training sequence.
        
        Returns:
            Tuple of (input_ids, labels) both as tensors
        """
        if idx >= len(self):
            raise IndexError(f"Index {idx} out of range for dataset of size {len(self)}")
        
        seq_len = self.config.max_seq_len
        start = idx * seq_len
        end = start + seq_len + 1  # +1 for labels offset
        
        # Get tokens
        tokens = self.data[start:end].copy()
        
        # Create input and labels (shifted by 1)
        input_ids = torch.tensor(tokens[:-1], dtype=torch.long)
        labels = torch.tensor(tokens[1:], dtype=torch.long)
        
        return input_ids, labels
    
    def get_stats(self) -> dict:
        """Get dataset statistics."""
        return {
            "total_tokens": self.metadata["total_tokens"],
            "num_sequences": len(self),
            "seq_len": self.config.max_seq_len,
            "size_mb": self.metadata.get("allocated_size", 0) * 4 / (1024 * 1024)
        }


class StreamingMemmapDataset(IterableDataset):
    """
    Streaming version of MemmapDataset for very large datasets.
    Iterates through data sequentially without random access overhead.
    """
    
    def __init__(self, config: MemmapConfig):
        self.config = config
        self.memmap_dir = Path(config.memmap_dir)
        self.data_path = self.memmap_dir / "tokens.dat"
        self.meta_path = self.memmap_dir / "metadata.json"
        
        if self.meta_path.exists():
            with open(self.meta_path, 'r') as f:
                self.metadata = json.load(f)
        else:
            raise FileNotFoundError(f"Dataset not found at {self.memmap_dir}")
    
    def __iter__(self) -> Iterator[Tuple[torch.Tensor, torch.Tensor]]:
        dtype = getattr(np, self.config.dtype)
        data = np.memmap(
            self.data_path,
            dtype=dtype,
            mode='r',
            shape=(self.metadata["total_tokens"],)
        )
        
        seq_len = self.config.max_seq_len
        num_seqs = self.metadata["total_tokens"] // (seq_len + 1)
        
        for idx in range(num_seqs):
            start = idx * seq_len
            end = start + seq_len + 1
            
            tokens = data[start:end].copy()
            input_ids = torch.tensor(tokens[:-1], dtype=torch.long)
            labels = torch.tensor(tokens[1:], dtype=torch.long)
            
            yield input_ids, labels


class DataCollector:
    """
    Manages data collection and preprocessing for continuous learning.
    """
    
    def __init__(self, dataset: MemmapDataset, tokenizer):
        self.dataset = dataset
        self.tokenizer = tokenizer
        self.buffer = []
        self.buffer_tokens = 0
        self.flush_threshold = 10000  # Flush every 10k tokens
    
    def add_text(self, text: str, source: str = "unknown"):
        """Add text with metadata."""
        tokens = self.tokenizer.encode(text, add_special_tokens=False)
        self.buffer.extend(tokens)
        self.buffer_tokens += len(tokens)
        
        if self.buffer_tokens >= self.flush_threshold:
            self.flush()
    
    def flush(self):
        """Flush buffer to disk."""
        if self.buffer:
            self.dataset.add_tokens(self.buffer)
            self.buffer = []
            self.buffer_tokens = 0
    
    def get_stats(self) -> dict:
        """Get collector statistics."""
        return {
            "buffer_tokens": self.buffer_tokens,
            "dataset_stats": self.dataset.get_stats()
        }


def create_dataset_from_texts(texts: List[str], config: MemmapConfig, tokenizer) -> MemmapDataset:
    """
    Create a memory-mapped dataset from a list of texts.
    
    Args:
        texts: List of training texts
        config: Memmap configuration
        tokenizer: Tokenizer instance
    
    Returns:
        MemmapDataset instance
    """
    dataset = MemmapDataset(config, tokenizer)
    collector = DataCollector(dataset, tokenizer)
    
    for text in texts:
        collector.add_text(text)
    
    collector.flush()
    return dataset
