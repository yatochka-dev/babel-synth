import uvicorn
from fastapi import FastAPI, WebSocket
from room import handle_ws

app = FastAPI()


@app.websocket("/ws/{room_id}/{user_id}")
async def ws_endpoint(ws: WebSocket, room_id: str, user_id: str):
    await handle_ws(ws, room_id, user_id)


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=5000)
