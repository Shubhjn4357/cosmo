"""
Cosmo AI - File Processing API Routes
Upload and extract content from various file formats.
"""

import asyncio
import os
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from loguru import logger
from services.approved_model_catalog import (
    DEFAULT_FALLBACK_OCR_MODEL_ID,
    DEFAULT_OCR_MODEL_ID,
    get_ocr_model,
)
from services.local_model_service import (
    LocalModelError,
    invoke_openai_compatible_ocr,
    resolve_local_adapter,
    run_local_command_template,
)
from utils.app_paths import UPLOADS_DIR


router = APIRouter()


class FileReadResponse(BaseModel):
    """File reading response model."""
    content: str
    file_type: str
    pages: Optional[int] = None
    word_count: int
    characters: int
    ocr_model_id: Optional[str] = None
    ocr_backend: Optional[str] = None


class FileAnalyzeRequest(BaseModel):
    """File analysis request model."""
    question: str


class FileAnalyzeResponse(BaseModel):
    """File analysis response model."""
    answer: str
    relevant_text: str


# File readers
class FileReader:
    """Universal file reader supporting multiple formats."""
    
    SUPPORTED_EXTENSIONS = {
        '.pdf': 'pdf',
        '.txt': 'text',
        '.md': 'text',
        '.py': 'text',
        '.js': 'text',
        '.json': 'text',
        '.csv': 'csv',
        '.docx': 'docx',
        '.doc': 'doc',
        '.png': 'image',
        '.jpg': 'image',
        '.jpeg': 'image',
        '.xlsx': 'excel',
        '.xls': 'excel'
    }
    
    @classmethod
    def detect_type(cls, filename: str) -> str:
        """Detect file type from extension."""
        ext = Path(filename).suffix.lower()
        return cls.SUPPORTED_EXTENSIONS.get(ext, 'unknown')
    
    @classmethod
    async def read(cls, filepath: Path, file_type: str, *, ocr_model_id: Optional[str] = None) -> dict:
        """Read file content based on type."""
        readers = {
            'pdf': cls._read_pdf,
            'text': cls._read_text,
            'csv': cls._read_csv,
            'docx': cls._read_docx,
            'image': cls._read_image,
            'excel': cls._read_excel
        }
        
        reader = readers.get(file_type)
        if reader is None:
            raise ValueError(f"Unsupported file type: {file_type}")

        if file_type == 'image':
            return await cls._read_image(filepath, ocr_model_id=ocr_model_id)

        return await reader(filepath)
    
    @classmethod
    async def _read_pdf(cls, filepath: Path) -> dict:
        """Read PDF file."""
        try:
            import fitz  # PyMuPDF
            
            doc = fitz.open(filepath)
            text_parts = []
            
            for page in doc:
                text_parts.append(page.get_text())
            
            text = "\n\n".join(text_parts)
            num_pages = len(doc)
            doc.close()
            
            return {
                "content": text,
                "pages": num_pages
            }
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="PyMuPDF not installed. Run: pip install PyMuPDF"
            )
    
    @classmethod
    async def _read_text(cls, filepath: Path) -> dict:
        """Read text file."""
        content = filepath.read_text(encoding='utf-8', errors='replace')
        return {"content": content}
    
    @classmethod
    async def _read_csv(cls, filepath: Path) -> dict:
        """Read CSV file."""
        try:
            import pandas as pd
            
            df = pd.read_csv(filepath)
            content = df.to_string()
            
            return {"content": content}
        except ImportError:
            # Fallback to basic CSV reading
            content = filepath.read_text(encoding='utf-8', errors='replace')
            return {"content": content}
    
    @classmethod
    async def _read_docx(cls, filepath: Path) -> dict:
        """Read Word document."""
        try:
            from docx import Document
            
            doc = Document(filepath)
            paragraphs = [p.text for p in doc.paragraphs]
            content = "\n\n".join(paragraphs)
            
            return {"content": content}
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="python-docx not installed. Run: pip install python-docx"
            )
    
    @classmethod
    async def _read_image(cls, filepath: Path, ocr_model_id: Optional[str] = None) -> dict:
        """Read image with OCR."""
        resolved_model_id = (ocr_model_id or DEFAULT_OCR_MODEL_ID).strip() or DEFAULT_OCR_MODEL_ID
        selected_model = get_ocr_model(resolved_model_id)
        if selected_model is None:
            raise HTTPException(status_code=400, detail=f"Unknown OCR model: {resolved_model_id}")

        if selected_model.id == "glm-ocr":
            adapter = resolve_local_adapter("glm_ocr")
            base_url = str(adapter.get("base_url") or "").strip()
            command_template = str(adapter.get("command_template") or "").strip()
            local_model_name = str(adapter.get("model_name") or selected_model.repo_id or "glm-ocr").strip()

            if base_url:
                try:
                    result = await invoke_openai_compatible_ocr(
                        base_url=base_url,
                        model=local_model_name,
                        image_bytes=filepath.read_bytes(),
                        api_key=adapter.get("api_key"),
                    )
                    text = (result.get("text") or "").strip()
                    if text:
                        return {
                            "content": text,
                            "ocr_model_id": selected_model.id,
                            "ocr_backend": result.get("backend") or "local_endpoint",
                        }
                except LocalModelError as exc:
                    logger.warning(f"GLM-OCR local endpoint failed, falling back to Tesseract: {exc}")

            if command_template:
                try:
                    result = await asyncio.to_thread(
                        run_local_command_template,
                        command_template=command_template,
                        values={
                            "image_path": str(filepath),
                            "model": local_model_name,
                            "prompt": "Extract all readable text from this image.",
                        },
                        cwd=str(adapter.get("command_cwd") or "").strip() or None,
                    )
                    text = (result.get("text") or "").strip()
                    if text:
                        return {
                            "content": text,
                            "ocr_model_id": selected_model.id,
                            "ocr_backend": result.get("backend") or "local_command",
                        }
                except LocalModelError as exc:
                    logger.warning(f"GLM-OCR local command failed, falling back to Tesseract: {exc}")

        try:
            import pytesseract
            from PIL import Image
            
            img = Image.open(filepath)
            text = pytesseract.image_to_string(img)
            
            return {
                "content": text,
                "ocr_model_id": DEFAULT_FALLBACK_OCR_MODEL_ID,
                "ocr_backend": "pytesseract",
            }
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="pytesseract/Pillow not installed or Tesseract not available"
            )
    
    @classmethod
    async def _read_excel(cls, filepath: Path) -> dict:
        """Read Excel file."""
        try:
            import pandas as pd
            
            df = pd.read_excel(filepath)
            content = df.to_string()
            
            return {"content": content}
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="pandas/openpyxl not installed"
            )


@router.post("/files/read")
async def read_file(
    file: UploadFile = File(...),
    ocr_model_id: Optional[str] = Form(default=None),
) -> FileReadResponse:
    """
    Extract text content from an uploaded file.
    
    Supports: PDF, TXT, MD, DOCX, CSV, XLSX, PNG, JPG (OCR)
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    
    # Detect file type
    file_type = FileReader.detect_type(file.filename)
    if file_type == 'unknown':
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Supported: {list(FileReader.SUPPORTED_EXTENSIONS.keys())}"
        )
    
    # Save file temporarily
    upload_dir = UPLOADS_DIR / "temp"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    temp_path = upload_dir / file.filename
    
    try:
        content = await file.read()
        temp_path.write_bytes(content)
        
        # Read file
        result = await FileReader.read(temp_path, file_type, ocr_model_id=ocr_model_id)
        text_content = result["content"]
        
        return FileReadResponse(
            content=text_content,
            file_type=file_type,
            pages=result.get("pages"),
            word_count=len(text_content.split()),
            characters=len(text_content),
            ocr_model_id=result.get("ocr_model_id"),
            ocr_backend=result.get("ocr_backend"),
        )
    
    finally:
        # Cleanup
        if temp_path.exists():
            temp_path.unlink()


@router.post("/files/analyze")
async def analyze_file(
    file: UploadFile = File(...),
    question: str = Form(...),
    ocr_model_id: Optional[str] = Form(default=None),
) -> FileAnalyzeResponse:
    """
    Upload a file and ask a question about its contents.
    
    Uses RAG to find relevant sections and generates an answer.
    """
    from api.route import get_app_state
    
    state = get_app_state()
    
    if state.chat_runtime is None:
        raise HTTPException(status_code=503, detail="Chat runtime not configured")
    
    # First, read the file
    file_type = FileReader.detect_type(file.filename or "unknown.txt")
    if file_type == 'unknown':
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    upload_dir = UPLOADS_DIR / "temp"
    upload_dir.mkdir(parents=True, exist_ok=True)
    temp_path = upload_dir / (file.filename or "temp_file")
    
    try:
        content = await file.read()
        temp_path.write_bytes(content)
        
        result = await FileReader.read(temp_path, file_type, ocr_model_id=ocr_model_id)
        file_content = result["content"]
        
        # Create prompt with file content
        prompt = f"""Based on the following document, answer the question.

Document:
{file_content[:4000]}

Question: {question}

Answer:"""
        
        result = await asyncio.to_thread(
            state.chat_runtime.generate,
            prompt,
            256,
            0.2,
            0.9,
        )
        answer = (result.get("text") or "").strip()
        
        return FileAnalyzeResponse(
            answer=answer,
            relevant_text=file_content[:500] + "..."
        )
    
    finally:
        if temp_path.exists():
            temp_path.unlink()


@router.get("/files/supported")
async def list_supported_formats():
    """List supported file formats."""
    return {
        "formats": [
            {"extension": ext, "type": ftype}
            for ext, ftype in FileReader.SUPPORTED_EXTENSIONS.items()
        ]
    }
