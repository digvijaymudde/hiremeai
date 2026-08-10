from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles

try:
    from utilityFunctions import ChatRequest, ask_candidate, get_or_parse_resume
except ModuleNotFoundError:
    from backend.utilityFunctions import ChatRequest, ask_candidate, get_or_parse_resume

from pathlib import Path

app = FastAPI(title="HireMe AI - Digvijay Mudde Avatar")

# Handle CORS preflight OPTIONS requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

def get_resume_pdf_path() -> Path:
    resume_dir = Path(__file__).parent / "Resume"
    pdf_files = list(resume_dir.glob("*.pdf"))
    if pdf_files:
        return pdf_files[0]
    return resume_dir / "Digvijay Mudde GenAI.pdf"

JSON_CACHE_PATH = Path(__file__).parent / "Resume" / "parsed_resume.json"

@app.get("/api/info")
def api_info():
    resume_path = get_resume_pdf_path()
    resume = get_or_parse_resume(resume_path, JSON_CACHE_PATH)
    return {
        "message": "HireMe AI - Candidate Avatar API is running",
        "candidate": resume.name,
        "email": resume.email,
        "skills": resume.skills,
        "education": resume.education,
        "projects": resume.projects
    }

@app.get("/download-resume")
def download_resume():
    """Allows visitors/recruiters to download Digvijay's official PDF resume."""
    resume_path = get_resume_pdf_path()
    if resume_path.exists():
        return FileResponse(
            path=resume_path,
            filename="Digvijay_Sachin_Mudde_Resume.pdf",
            media_type="application/pdf"
        )
    raise HTTPException(status_code=404, detail="Resume PDF file not found")

@app.post("/chat")
def chat(request: ChatRequest):
    # Auto-detects PDF and loads from JSON cache (or parses if cache missing)
    resume_path = get_resume_pdf_path()
    resume = get_or_parse_resume(resume_path, JSON_CACHE_PATH)
    
    return StreamingResponse(
        ask_candidate(question=request.question, resume=resume, history=request.history), 
        media_type="text/plain"
    )

@app.post("/reparse")
def reparse():
    """Forces re-parsing the PDF resume and updating the JSON cache."""
    resume_path = get_resume_pdf_path()
    resume = get_or_parse_resume(resume_path, JSON_CACHE_PATH, force_reload=True)
    return {
        "message": f"Resume '{resume_path.name}' successfully re-parsed and cache updated!",
        "candidate": resume.name
    }

# Serve static frontend files if directory exists
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")





