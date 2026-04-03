import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    AZURE_OPENAI_API_BASE = os.getenv('AZURE_OPENAI_API_BASE', '')
    AZURE_OPENAI_API_KEY = os.getenv('AZURE_OPENAI_API_KEY', '')
    AZURE_OPENAI_API_VERSION = os.getenv('AZURE_OPENAI_API_VERSION', '2023-05-15')
    AZURE_OPENAI_DEPLOYMENT = os.getenv('AZURE_OPENAI_DEPLOYMENT', '')

settings = Settings()
