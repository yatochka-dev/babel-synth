import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const port = parseInt(process.env.PORT ?? "3000", 10);

interface JoinRoomPayload {
  roomId: string;
  userId: string;
  name: string;
}

interface OfferPayload {
  sdp: RTCSessionDescriptionInit;
  targetUserId: string;
}

interface AnswerPayload {
  sdp: RTCSessionDescriptionInit;
  targetUserId: string;
}

interface IceCandidatePayload {
  candidate: RTCIceCandidate;
  targetUserId: string;
}

void app.prepare().then(() => {
  const expressApp = express();
  const httpServer = createServer(expressApp);
  const io = new Server(httpServer);

  // Socket.io Logic
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on(
      "join-room",
      ({ roomId, name }: Omit<JoinRoomPayload, "userId">) => {
        console.log(`User ${name} (${socket.id}) joined room ${roomId}`);
        void socket.join(roomId);
        socket.to(roomId).emit("user-connected", { userId: socket.id, name });

        socket.on("disconnect", () => {
          console.log(`User ${socket.id} disconnected`);
          socket.to(roomId).emit("user-disconnected", { userId: socket.id });
        });
      },
    );

    socket.on("offer", ({ sdp, targetUserId }: OfferPayload) => {
      socket.to(targetUserId).emit("offer", { sdp, senderUserId: socket.id });
    });

    socket.on("answer", ({ sdp, targetUserId }: AnswerPayload) => {
      socket.to(targetUserId).emit("answer", { sdp, senderUserId: socket.id });
    });

    socket.on(
      "ice-candidate",
      ({ candidate, targetUserId }: IceCandidatePayload) => {
        socket
          .to(targetUserId)
          .emit("ice-candidate", { candidate, senderUserId: socket.id });
      },
    );
  });

  // Next.js Request Handler
  expressApp.all("*splat", (req, res) => {
    return handle(req, res);
  });

  httpServer.listen(port, () => {
    console.log(
      `> Server listening at http://localhost:${port} as ${
        dev ? "development" : process.env.NODE_ENV
      }`,
    );
  });
});
