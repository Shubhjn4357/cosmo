"""
Whisper AI - BPE Tokenizer
Efficient byte-pair encoding tokenizer with training and serialization support.
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from collections import Counter
import re


@dataclass
class TokenizerConfig:
    """Tokenizer configuration."""
    vocab_size: int = 16384
    min_frequency: int = 2
    special_tokens: List[str] = None
    
    def __post_init__(self):
        if self.special_tokens is None:
            self.special_tokens = ["<PAD>", "<UNK>", "<BOS>", "<EOS>", "<SEP>", "<MASK>"]


class WhisperTokenizer:
    """
    Custom BPE Tokenizer for Whisper AI.
    
    Features:
    - Byte-level BPE
    - Special tokens support
    - Fast encode/decode
    - Serialization support
    """
    
    def __init__(self, config: Optional[TokenizerConfig] = None):
        self.config = config or TokenizerConfig()
        
        # Initialize vocabulary with special tokens
        self.token_to_id: Dict[str, int] = {}
        self.id_to_token: Dict[int, str] = {}
        self.merges: List[Tuple[str, str]] = []
        
        # Add special tokens
        for i, token in enumerate(self.config.special_tokens):
            self.token_to_id[token] = i
            self.id_to_token[i] = token
        
        # Special token IDs
        self.pad_id = self.token_to_id.get("<PAD>", 0)
        self.unk_id = self.token_to_id.get("<UNK>", 1)
        self.bos_id = self.token_to_id.get("<BOS>", 2)
        self.eos_id = self.token_to_id.get("<EOS>", 3)
        
        self._byte_vocab_initialized = False
    
    def _init_byte_vocab(self):
        """Initialize byte-level vocabulary."""
        if self._byte_vocab_initialized:
            return
        
        # Add all byte values as initial tokens
        start_idx = len(self.config.special_tokens)
        for i in range(256):
            token = bytes([i]).decode("latin-1")
            if token not in self.token_to_id:
                self.token_to_id[token] = start_idx + i
                self.id_to_token[start_idx + i] = token
        
        self._byte_vocab_initialized = True
    
    def _tokenize_to_bytes(self, text: str) -> List[str]:
        """Convert text to list of byte characters."""
        return list(text.encode("utf-8").decode("latin-1"))
    
    def _get_pairs(self, tokens: List[str]) -> Counter:
        """Get all adjacent pairs in tokens."""
        pairs = Counter()
        for i in range(len(tokens) - 1):
            pairs[(tokens[i], tokens[i + 1])] += 1
        return pairs
    
    def train(self, texts: List[str], verbose: bool = True):
        """
        Train BPE tokenizer on a corpus.
        
        Args:
            texts: List of training texts
            verbose: Whether to print progress
        """
        self._init_byte_vocab()
        
        if verbose:
            print(f"Training tokenizer with vocab_size={self.config.vocab_size}")
        
        # Tokenize all texts to bytes
        word_freqs: Dict[tuple, int] = Counter()
        for text in texts:
            words = re.findall(r'\S+|\s+', text)  # Split by words/spaces
            for word in words:
                byte_tokens = tuple(self._tokenize_to_bytes(word))
                word_freqs[byte_tokens] += 1
        
        # Build initial word-token lists
        splits = {word: list(word) for word in word_freqs}
        
        # Iteratively merge most frequent pairs
        num_merges = self.config.vocab_size - len(self.token_to_id)
        
        for i in range(num_merges):
            # Count all pairs across all words
            pair_freqs = Counter()
            for word, freq in word_freqs.items():
                tokens = splits[word]
                for j in range(len(tokens) - 1):
                    pair = (tokens[j], tokens[j + 1])
                    pair_freqs[pair] += freq
            
            if not pair_freqs:
                break
            
            # Find most frequent pair
            best_pair = pair_freqs.most_common(1)[0]
            if best_pair[1] < self.config.min_frequency:
                break
            
            pair = best_pair[0]
            new_token = pair[0] + pair[1]
            
            # Add to vocabulary
            new_id = len(self.token_to_id)
            self.token_to_id[new_token] = new_id
            self.id_to_token[new_id] = new_token
            self.merges.append(pair)
            
            # Apply merge to all words
            for word in splits:
                tokens = splits[word]
                new_tokens = []
                j = 0
                while j < len(tokens):
                    if j < len(tokens) - 1 and tokens[j] == pair[0] and tokens[j + 1] == pair[1]:
                        new_tokens.append(new_token)
                        j += 2
                    else:
                        new_tokens.append(tokens[j])
                        j += 1
                splits[word] = new_tokens
            
            if verbose and (i + 1) % 1000 == 0:
                print(f"Merge {i + 1}/{num_merges}: {pair} -> {new_token}")
        
        if verbose:
            print(f"Tokenizer trained. Vocabulary size: {len(self.token_to_id)}")
    
    def encode(self, text: str, add_special_tokens: bool = True) -> List[int]:
        """
        Encode text to token IDs.
        
        Args:
            text: Input text
            add_special_tokens: Whether to add BOS/EOS tokens
        
        Returns:
            List of token IDs
        """
        if not self._byte_vocab_initialized:
            self._init_byte_vocab()
        
        tokens = self._tokenize_to_bytes(text)
        
        # Apply merges
        for pair in self.merges:
            new_token = pair[0] + pair[1]
            new_tokens = []
            i = 0
            while i < len(tokens):
                if i < len(tokens) - 1 and tokens[i] == pair[0] and tokens[i + 1] == pair[1]:
                    new_tokens.append(new_token)
                    i += 2
                else:
                    new_tokens.append(tokens[i])
                    i += 1
            tokens = new_tokens
        
        # Convert to IDs
        ids = [self.token_to_id.get(t, self.unk_id) for t in tokens]
        
        if add_special_tokens:
            ids = [self.bos_id] + ids + [self.eos_id]
        
        return ids
    
    def decode(self, ids: List[int], skip_special_tokens: bool = True) -> str:
        """
        Decode token IDs to text.
        
        Args:
            ids: List of token IDs
            skip_special_tokens: Whether to skip special tokens
        
        Returns:
            Decoded text
        """
        special_ids = set(range(len(self.config.special_tokens)))
        
        tokens = []
        for id in ids:
            if skip_special_tokens and id in special_ids:
                continue
            token = self.id_to_token.get(id, "")
            tokens.append(token)
        
        # Convert from Latin-1 bytes back to UTF-8
        byte_string = "".join(tokens).encode("latin-1")
        try:
            return byte_string.decode("utf-8")
        except UnicodeDecodeError:
            return byte_string.decode("utf-8", errors="replace")
    
    def batch_encode(self, texts: List[str], max_length: Optional[int] = None, padding: bool = False) -> dict:
        """
        Encode a batch of texts with optional padding.
        
        Args:
            texts: List of input texts
            max_length: Maximum sequence length (truncate if longer)
            padding: Whether to pad to max_length
        
        Returns:
            Dictionary with 'input_ids' and 'attention_mask'
        """
        encoded = [self.encode(text) for text in texts]
        
        if max_length:
            encoded = [ids[:max_length] for ids in encoded]
        
        if padding:
            max_len = max_length or max(len(ids) for ids in encoded)
            attention_mask = []
            for i, ids in enumerate(encoded):
                mask = [1] * len(ids) + [0] * (max_len - len(ids))
                encoded[i] = ids + [self.pad_id] * (max_len - len(ids))
                attention_mask.append(mask)
            return {"input_ids": encoded, "attention_mask": attention_mask}
        
        return {"input_ids": encoded}
    
    def vocab_size(self) -> int:
        """Get vocabulary size."""
        return len(self.token_to_id)
    
    def save(self, path: str):
        """Save tokenizer to file."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        
        data = {
            "config": {
                "vocab_size": self.config.vocab_size,
                "min_frequency": self.config.min_frequency,
                "special_tokens": self.config.special_tokens
            },
            "vocab": self.token_to_id,
            "merges": [[p[0], p[1]] for p in self.merges]
        }
        
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    @classmethod
    def load(cls, path: str) -> "WhisperTokenizer":
        """Load tokenizer from file."""
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        config = TokenizerConfig(**data["config"])
        tokenizer = cls(config)
        tokenizer.token_to_id = data["vocab"]
        tokenizer.id_to_token = {v: k for k, v in data["vocab"].items()}
        tokenizer.merges = [tuple(m) for m in data["merges"]]
        tokenizer._byte_vocab_initialized = True
        
        return tokenizer


def create_pretrained_tokenizer() -> WhisperTokenizer:
    """
    Create a tokenizer with a reasonable pretrained vocabulary.
    This uses a basic English-focused vocabulary for quick start.
    """
    config = TokenizerConfig(vocab_size=16384)
    tokenizer = WhisperTokenizer(config)
    tokenizer._init_byte_vocab()
    
    # Add common English word pieces
    common_pieces = [
        "the", "ing", "tion", "and", "ent", "ion", "ter", "for",
        "ation", "ere", "her", "ment", "per", "all", "pro", "are",
        "ess", "not", "ver", "eve", "con", "com", "you", "was",
        "have", "this", "from", "with", "they", "will", "would",
        "there", "their", "what", "about", "which", "when", "make",
        "like", "time", "just", "know", "take", "people", "into",
        "year", "your", "good", "some", "could", "them", "than",
        "look", "only", "come", "over", "such", "think", "also",
        "back", "after", "work", "first", "well", "even", "want",
        "because", "these", "give", "most", "hand", "where",
    ]
    
    for piece in common_pieces:
        if piece not in tokenizer.token_to_id:
            idx = len(tokenizer.token_to_id)
            tokenizer.token_to_id[piece] = idx
            tokenizer.id_to_token[idx] = piece
    
    return tokenizer
