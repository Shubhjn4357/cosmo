"""
Cosmo AI - Tokenizer utilities.

Supports the legacy in-repo byte-BPE format for backwards compatibility and a
modern ByteLevel BPE tokenizer powered by `tokenizers` for whitespace-safe
training and decoding.
"""

from __future__ import annotations

import importlib.util
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


TOKENIZER_FORMAT_VERSION = 2
TOKENIZER_BACKEND_LEGACY = "legacy_byte_bpe"
TOKENIZER_BACKEND_BYTELEVEL = "tokenizers_bytelevel_bpe"


@dataclass
class TokenizerConfig:
    """Tokenizer configuration."""
    vocab_size: int = 16384
    min_frequency: int = 2
    backend: str = TOKENIZER_BACKEND_BYTELEVEL
    special_tokens: List[str] = None  # type: ignore
    
    def __post_init__(self):
        if self.special_tokens is None:
            self.special_tokens = ["<PAD>", "<UNK>", "<BOS>", "<EOS>", "<SEP>", "<MASK>"]


class CosmoTokenizer:
    """
    Custom BPE Tokenizer for Cosmo AI.
    
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
        self._backend_type = TOKENIZER_BACKEND_LEGACY
        self._fast_tokenizer = None

        if self.config.backend == TOKENIZER_BACKEND_BYTELEVEL:
            self._maybe_init_fast_backend()

    def _tokenizers_available(self) -> bool:
        return importlib.util.find_spec("tokenizers") is not None

    def _maybe_init_fast_backend(self):
        if not self._tokenizers_available():
            return
        if self._fast_tokenizer is not None:
            return

        from tokenizers import Tokenizer, decoders, models, pre_tokenizers  # type: ignore

        tokenizer = Tokenizer(models.BPE(unk_token="<UNK>"))
        tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
        tokenizer.decoder = decoders.ByteLevel()
        self._fast_tokenizer = tokenizer
        self._backend_type = TOKENIZER_BACKEND_BYTELEVEL

    def _sync_vocab_from_fast_backend(self):
        if self._fast_tokenizer is None:
            return

        vocab = self._fast_tokenizer.get_vocab()
        self.token_to_id = dict(vocab)
        self.id_to_token = {token_id: token for token, token_id in vocab.items()}

        self.pad_id = self.token_to_id.get("<PAD>", 0)
        self.unk_id = self.token_to_id.get("<UNK>", 1)
        self.bos_id = self.token_to_id.get("<BOS>", 2)
        self.eos_id = self.token_to_id.get("<EOS>", 3)
    
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
        pairs = Counter()  # type: ignore
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
        if self.config.backend == TOKENIZER_BACKEND_BYTELEVEL and self._tokenizers_available():
            self._train_bytelevel_tokenizer(texts, verbose=verbose)
            return

        self._backend_type = TOKENIZER_BACKEND_LEGACY
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
            pair_freqs = Counter()  # type: ignore
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

    def _train_bytelevel_tokenizer(self, texts: List[str], *, verbose: bool = True):
        from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers

        self._maybe_init_fast_backend()

        tokenizer = Tokenizer(models.BPE(unk_token="<UNK>"))
        tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
        tokenizer.decoder = decoders.ByteLevel()
        trainer = trainers.BpeTrainer(
            vocab_size=self.config.vocab_size,
            min_frequency=self.config.min_frequency,
            special_tokens=self.config.special_tokens,
            initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
            show_progress=verbose,
        )
        tokenizer.train_from_iterator((text for text in texts if text), trainer=trainer)
        self._fast_tokenizer = tokenizer
        self._backend_type = TOKENIZER_BACKEND_BYTELEVEL
        self._sync_vocab_from_fast_backend()

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
        if self._fast_tokenizer is not None and self._backend_type == TOKENIZER_BACKEND_BYTELEVEL:
            encoded = self._fast_tokenizer.encode(text)
            ids = list(encoded.ids)
            if add_special_tokens:
                ids = [self.bos_id] + ids + [self.eos_id]
            return ids

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

        if self._fast_tokenizer is not None and self._backend_type == TOKENIZER_BACKEND_BYTELEVEL:
            filtered_ids = [
                token_id
                for token_id in ids
                if not (skip_special_tokens and token_id in special_ids)
            ]
            return self._fast_tokenizer.decode(filtered_ids, skip_special_tokens=False)

        tokens = []
        for token_id in ids:
            if skip_special_tokens and token_id in special_ids:
                continue
            token = self.id_to_token.get(token_id, "")
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

    def is_modern_backend(self) -> bool:
        return self._backend_type == TOKENIZER_BACKEND_BYTELEVEL
    
    def save(self, path: str):
        """Save tokenizer to file."""
        path = Path(path)  # type: ignore
        path.parent.mkdir(parents=True, exist_ok=True)  # type: ignore

        data = {
            "format_version": TOKENIZER_FORMAT_VERSION,
            "backend": self._backend_type,
            "config": {
                "vocab_size": self.config.vocab_size,
                "min_frequency": self.config.min_frequency,
                "backend": self.config.backend,
                "special_tokens": self.config.special_tokens,
            },
        }

        if self._fast_tokenizer is not None and self._backend_type == TOKENIZER_BACKEND_BYTELEVEL:
            data["tokenizer_json"] = json.loads(self._fast_tokenizer.to_str())
        else:
            data["vocab"] = self.token_to_id
            data["merges"] = [[p[0], p[1]] for p in self.merges]

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    @classmethod
    def load(cls, path: str) -> "CosmoTokenizer":
        """Load tokenizer from file."""
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        config = TokenizerConfig(**data.get("config", {}))
        tokenizer = cls(config)

        if data.get("backend") == TOKENIZER_BACKEND_BYTELEVEL and "tokenizer_json" in data and tokenizer._tokenizers_available():
            from tokenizers import Tokenizer

            tokenizer._fast_tokenizer = Tokenizer.from_str(json.dumps(data["tokenizer_json"], ensure_ascii=False))
            tokenizer._backend_type = TOKENIZER_BACKEND_BYTELEVEL
            tokenizer._sync_vocab_from_fast_backend()
            tokenizer._byte_vocab_initialized = False
            return tokenizer

        tokenizer._backend_type = TOKENIZER_BACKEND_LEGACY
        tokenizer.token_to_id = data["vocab"]
        tokenizer.id_to_token = {v: k for k, v in data["vocab"].items()}
        tokenizer.merges = [tuple(m) for m in data.get("merges", [])]
        tokenizer._byte_vocab_initialized = True

        return tokenizer


def create_pretrained_tokenizer() -> CosmoTokenizer:
    """
    Create a whitespace-safe tokenizer bootstrapped on a small built-in corpus.
    """
    config = TokenizerConfig(vocab_size=4096, min_frequency=1, backend=TOKENIZER_BACKEND_BYTELEVEL)
    tokenizer = CosmoTokenizer(config)
    bootstrap_corpus = [
        "Sure! Here's a simple Python code example that prints a greeting.",
        "User:\nHow do I reverse a list in Python?\n\nAssistant:\nUse list.reverse() for in-place mutation or list[::-1] to create a copy.",
        "User:\nWrite a portfolio bio.\n\nAssistant:\nFrontend developer focused on React, TypeScript, performance, and clean UX.",
        "Python uses indentation and whitespace to define code blocks.",
        "Machine learning models predict the next token in a sequence of text.",
        "Whitespace matters. Preserve spaces, newlines, and punctuation in generated text.",
        "def greet(name):\n    return f\"Hello, {name}!\"",
    ]
    tokenizer.train(bootstrap_corpus, verbose=False)
    return tokenizer
