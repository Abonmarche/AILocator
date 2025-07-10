import os
import pathlib
import sys
from google import genai
from pydantic import BaseModel

# Set your Gemini API key here or via environment variable
API_KEY = os.getenv('GEMINI_API_KEY', 'AIzaSyAx4z6oxc3ilBT_1vrzzp7uB3yL1-8_bTg')

# Path to the PDF file (hardcoded to your document)
pdf_path = r"C:\Users\ggarcia\OneDrive - Abonmarche\Documents\GitHub\AILocator\Images\2020-12-04_AS-BUILT_19-0183 SHEET SET-720 - Markup.pdf"

# Define a Pydantic model for the structured output
class ProjectRecord(BaseModel):
    title: str
    date: str

def main():
    if not os.path.exists(pdf_path):
        print(f"File not found: {pdf_path}")
        sys.exit(1)

    client = genai.Client(api_key=API_KEY)
    file_bytes = pathlib.Path(pdf_path).read_bytes()

    prompt = (
        "You are an expert at reading civil engineering project record PDFs. "
        "Extract the following fields: title (the main title of the document or project) and date (the date of the project or the date shown on the document). "
        "Return only the relevant information."
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            genai.types.Part.from_bytes(
                data=file_bytes,
                mime_type='application/pdf',
            ),
            prompt
        ],
        config={
            'response_mime_type': 'application/json',
            'response_schema': ProjectRecord,
        }
    )

    # Print the raw JSON string
    print(response.text)
    # Optionally, print as parsed object
    if response.parsed:
        print("\nParsed output:")
        print(response.parsed)

if __name__ == "__main__":
    main()
