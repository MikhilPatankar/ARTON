const socket = io();

let myId = null;

socket.on("connect", () => {
    myId = socket.id;
});