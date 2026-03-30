"""
Whisper AI - Email Notification Service
Send email notifications for security events and admin alerts
"""

import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from loguru import logger


# Email configuration
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "shubh.com.in@gmail.com")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER or "noreply@whisper-ai.app")


def send_email(
    to_email: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None
) -> bool:
    """
    Send email notification
   
    Args:
        to_email: Recipient email address
        subject: Email subject
        body_text: Plain text body
        body_html: Optional HTML body
       
    Returns:
        True if email sent successfully, False otherwise
    """
    # If SMTP not configured, just log and return
    if not SMTP_USER or not SMTP_PASSWORD:
        logger.warning(f"Email service not configured. Would have sent: {subject} to {to_email}")
        return False
   
    try:
        # Create message
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = FROM_EMAIL
        msg['To'] = to_email
       
        # Attach text and HTML parts
        part1 = MIMEText(body_text, 'plain')
        msg.attach(part1)
       
        if body_html:
            part2 = MIMEText(body_html, 'html')
            msg.attach(part2)
       
        # Send email
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
       
        logger.info(f"Email sent successfully to {to_email}")
        return True
       
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


def send_admin_alert(subject: str, message: str, details: dict = None) -> bool:
    """
    Send alert to admin
   
    Args:
        subject: Alert subject
        message: Alert message
        details: Optional additional details
       
    Returns:
        True if sent successfully
    """
    body_text = f"{message}\n\n"
   
    if details:
        body_text += "Details:\n"
        for key, value in details.items():
            body_text += f"  {key}: {value}\n"
   
    body_html = f"""
    <html>
      <body>
        <h2 style="color: #dc3545;">Whisper AI Admin Alert</h2>
        <p><strong>{message}</strong></p>
        {f'<h3>Details:</h3><ul>' + ''.join([f'<li><strong>{k}:</strong> {v}</li>' for k, v in details.items()]) + '</ul>' if details else ''}
        <hr>
        <p style="color: #6c757d; font-size: 12px;">
          This is an automated alert from Whisper AI security system.
        </p>
      </body>
    </html>
    """
   
    return send_email(ADMIN_EMAIL, f"[Whisper AI Alert] {subject}", body_text, body_html)


def send_ip_blocked_notification(ip: str, reason: str, device_info: dict) -> bool:
    """
    Send notification when an IP is blocked
   
    Args:
        ip: Blocked IP address
        reason: Reason for blocking
        device_info: Device information
       
    Returns:
        True if sent successfully
    """
    details = {
        "IP Address": ip,
        "Reason": reason,
        "User Agent": device_info.get("user_agent", "unknown"),
        "Origin": device_info.get("origin", "unknown"),
        **device_info
    }
   
    return send_admin_alert(
        subject="IP Address Blocked",
        message=f"IP address {ip} has been blocked due to: {reason}",
        details=details
    )
