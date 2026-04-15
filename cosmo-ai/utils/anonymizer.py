import re

import re

def anonymize_lesson(text: str) -> str:
    """
    Industrially strips PII and technical IDs from strategic lessons.
    Ensures that shared 'Golden Lessons' contain only logic, zero metadata.
    """
    if not text: return ""

    # 1. Mask IPv4 and IPv6 addresses
    text = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', '[IP]', text)
    text = re.sub(r'\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b', '[IP]', text)
    
    # 2. Mask Potential API Keys and Bearer Tokens (General high-entropy 32+ char)
    text = re.sub(r'\b[A-Za-z0-1_-]{32,}\b', '[KEY]', text)
    
    # 3. Mask Company Names (Case-insensitive industrial suffixes)
    text = re.sub(r'\b[A-Z0-9][A-Za-z0-9&]+ (Inc|Corp|LLC|Ltd|Group|Holdings|Solutions|Technologies|GmbH|PLC)\b', '[COMPANY]', text, flags=re.IGNORECASE)
    
    # 4. Mask UUIDs and common hex IDs (16+ chars)
    text = re.sub(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', '[ID]', text)
    text = re.sub(r'\b[0-9a-f]{16,}\b', '[ID]', text)
    
    # 5. Mask Emails
    text = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', text)

    # 6. Mask Phone Numbers (+xx xxx-xxx-xxxx)
    text = re.sub(r'\+?\d{1,3}[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}', '[PHONE]', text)
    
    return text
