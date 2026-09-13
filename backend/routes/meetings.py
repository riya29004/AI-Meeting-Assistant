from fastapi import APIRouter, UploadFile, File

router = APIRouter()


@router.get("/meetings")
def get_meetings():
    return {"message": "Meetings endpoint is working"}


@router.post("/meetings/upload")
async def upload_meeting(file: UploadFile = File(...)):
    upload_path = f"uploads/{file.filename}"

    with open(upload_path, "wb") as buffer:
        buffer.write(await file.read())

    return {
        "message": "File uploaded successfully",
        "filename": file.filename
    }