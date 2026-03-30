"""
Image Upscaling Service
Provides local image upscaling using OpenCV as fallback.
"""

import os
from pathlib import Path
from typing import Optional
from loguru import logger
from utils.app_paths import UPLOADS_DIR

try:
    import cv2
    import numpy as np
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    logger.warning("OpenCV not available. Local upscaling disabled.")


class UpscaleService:
    """Local image upscaling using OpenCV"""
    
    def __init__(self, output_dir: str = str(UPLOADS_DIR / "upscaled")):
        """Initialize upscale service"""
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    async def upscale_local(
        self,
        image_path: str,
        scale: int = 4,
        method: str = "cubic"
    ) -> Optional[str]:
        """
        Upscale image locally using OpenCV
        
        Args:
            image_path: Path to input image
            scale: Upscale factor (2, 4)
            method: Interpolation method (cubic, lanczos, linear)
            
        Returns:
            Path to upscaled image or None if failed
        """
        if not CV2_AVAILABLE:
            logger.error("OpenCV not available")
            return None
        
        try:
            # Read image
            img = cv2.imread(image_path)
            if img is None:
                logger.error(f"Failed to read image: {image_path}")
                return None
            
            h, w = img.shape[:2]
            new_h, new_w = h * scale, w * scale
            
            # Choose interpolation method
            interp = {
                "cubic": cv2.INTER_CUBIC,
                "lanczos": cv2.INTER_LANCZOS4,
                "linear": cv2.INTER_LINEAR,
                "nearest": cv2.INTER_NEAREST
            }.get(method, cv2.INTER_CUBIC)
            
            # Upscale
            upscaled = cv2.resize(img, (new_w, new_h), interpolation=interp)
            
            # Save
            input_path = Path(image_path)
            output_filename = f"{input_path.stem}_upscaled_{scale}x{input_path.suffix}"
            output_path = self.output_dir / output_filename
            
            cv2.imwrite(str(output_path), upscaled)
            
            logger.info(f"Upscaled image: {image_path} -> {output_path} ({scale}x)")
            return str(output_path)
            
        except Exception as e:
            logger.error(f"Local upscaling failed: {e}")
            return None


# Singleton instance
_upscale_service: Optional[UpscaleService] = None

def get_upscale_service() -> UpscaleService:
    """Get or create upscale service singleton"""
    global _upscale_service
    if _upscale_service is None:
        _upscale_service = UpscaleService()
    return _upscale_service
