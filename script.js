const client = {
    webrtcServer: "https://freewebrtcserver.com",
    websocketServer: "wss://chat-room-websocket-backend.herokuapp.com/",
    url: window.location.origin,
    roomID: "testRoom",
    participantID: Date.now() + "",
    config: {iceServers: [{urls: "stun:stun.l.google.com:19302"}]},
    // constraints: {audio: true, video: { width: 640, frameRate: 30, facingMode: "user" }},
    constraints: {audio: true, video: true},
    id: null,
    pc: null,
    webcam: null,
    datachannel: null,
    websocket: null,
    participants: {},
};

client.connectWebsocket = function() {
    client.websocket = new WebSocket(client.websocketServer + "?room=" + client.roomID + "&name=" + client.participantID);

    client.websocket.onopen = function(e) {
        console.log("websocket open");
        client.publish();
    };

    client.websocket.onmessage = function(event) {
        console.log("websocket message:", event.data);
        const message = JSON.parse(event.data);
        client.handleWebsocketMessage(message)
    };

    client.websocket.onclose = function(event) {
        console.log("websocket closed");
    };

    client.websocket.onerror = function(error) {
        console.log("websocket error");
    };
}

client.connectWebsocket();

client.handleWebsocketMessage = function(message) {
    if (message.action === "join") {
        setTimeout(() => {client.subscribe(message.participantID)}, 1000);
    } else if (message.action === "leave") {
        client.unsubscribe(message.participantID);
    } else if (message.action === "chat") {
        client.receiveChatMessage(message.message, message.participantID)
    }
}

const chat = document.getElementById("chat");
const sendChatMessageButton = document.getElementById("sendChatMessageButton");
const chatMessageInput = document.getElementById("chatMessageInput");
const screenshareButton = document.getElementById("screenshareButton");
const audioButton = document.getElementById("audioButton");
const videoButton = document.getElementById("videoButton");
const localVideo = document.getElementById("localVideo");
const bigVideo = document.getElementById("bigVideo");
const videoRow = document.getElementById("videoRow");

sendChatMessageButton.addEventListener("click", () => {client.sendChatMessage()})
screenshareButton.addEventListener("click", () => {client.startScreenshare()})
localVideo.addEventListener("click", () => {bigVideo.srcObject = localVideo.srcObject;})
videoButton.addEventListener("click", () => {client.hideVideo()})
audioButton.addEventListener("click", () => {client.muteAudio()})

client.hideVideo = async function () {
    const isVideoOn = client.webcam.getVideoTracks()[0].enabled;
    if (isVideoOn) {
        client.webcam.getVideoTracks()[0].enabled = false;
        videoButton.innerHTML = "UNHIDE"
    } else {
        client.webcam.getVideoTracks()[0].enabled = true;
        videoButton.innerHTML = "HIDE"
    }
}

client.muteAudio = async function () {
    const isAudioOn = client.webcam.getAudioTracks()[0].enabled;
    if (isAudioOn) {
        client.webcam.getAudioTracks()[0].enabled = false;
        audioButton.innerHTML = "UNMUTE"
    } else {
        client.webcam.getAudioTracks()[0].enabled = true;
        audioButton.innerHTML = "MUTE"
    }
}

client.startScreenshare = async function () {
    let screenStream;

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia(client.constraints);
    } catch(err) {
        alert("no permission to access screen")
    }
    
    screenshareButton.disabled = true;
    const screenTrack = screenStream.getVideoTracks()[0];
    localVideo.srcObject = screenStream;
    bigVideo.srcObject = screenStream;

    screenTrack.addEventListener("ended", () => {
        screenshareButton.disabled = false;
        localVideo.srcObject = client.webcam;
        bigVideo.srcObject = client.webcam;
        let senderList = client.pc.getSenders();
        senderList.forEach(sender => {
            if (sender.track.kind === "video") {
                sender.replaceTrack(client.webcam.getVideoTracks()[0]);
            }
        });
    });

    let senderList = client.pc.getSenders();
    senderList.forEach(sender => {
        if (sender.track.kind === "video") {
            sender.replaceTrack(screenTrack);
        }
    });
}

client.sendToWebrtcServer = async function(request) {
    console.log("http request:", request);
    const requestJSON = JSON.stringify(request);
    const responseJSON = await fetch(client.webrtcServer, {method: "POST", body: requestJSON});
    const response = await responseJSON.json();
    console.log("http response:", response);
    return response
}

client.startVideoshare = async function () {
    try {
        client.webcam = await navigator.mediaDevices.getUserMedia(client.constraints);    
    } catch (error) {
        alert("no permission to access camera")
    }
    localVideo.srcObject = client.webcam;
    bigVideo.srcObject = client.webcam;
    client.pc.addStream(client.webcam);
}

client.publish = async function() {
    client.pc = new RTCPeerConnection(client.config);
    client.addPeerconnectionListeners(client.pc, "local");
    await client.startVideoshare();
    client.datachannel = client.pc.createDataChannel("localDatachannel");
    client.addDatachannelListeners(client.datachannel, "local");
    client.pc.setLocalDescription(await client.pc.createOffer());
    client.pc.onicecandidate = async (ice) => {
        if (ice.candidate === null) {
            const response = await client.sendToWebrtcServer({action: "publish" , publisherID: client.participantID, sdp: client.pc.localDescription})
            client.pc.setRemoteDescription(response.sdp);
        }
    };
}

client.subscribe = async function(participantID) {
    let pc = new RTCPeerConnection(client.config);
    client.addPeerconnectionListeners(pc, participantID)
    client.participants[participantID] = pc;
    let video = client.createVideoElement(participantID);
    videoRow.appendChild(video);
    pc.ontrack = (track) => {video.srcObject = track.streams[0];}
    pc.addTransceiver("video");
    pc.addTransceiver("audio");
    let datachannel = pc.createDataChannel("remoteDatachannel")
    client.addDatachannelListeners(datachannel, participantID)
    pc.setLocalDescription(await pc.createOffer());
    pc.onicecandidate = async (ice) => {
        if (ice.candidate === null) {
            const response = await client.sendToWebrtcServer({action: "subscribe", publisherID: participantID, sdp: pc.localDescription})
            pc.setRemoteDescription(response.sdp);
        }
    };
}

client.unsubscribe = async function(participantID) {
    client.deleteVideoElement(participantID);
    client.participants[participantID].close();
}

client.sendChatMessage = function () {
    const message = chatMessageInput.value;
    if (message.length !== 0) {
        client.websocket.send(message);
    }
}

client.receiveChatMessage = function (message, participantID) {
    const p = document.createElement("p");
    p.innerText = participantID + ": " + message;
    chat.appendChild(p);
}

client.createVideoElement = function (participantID) {
    let video = document.createElement("video");
    video.id = "participant-" + participantID;
    video.autoplay = true;
    video.muted = false;
    video.playsInline = true;
    video.addEventListener("click", () => {bigVideo.srcObject = video.srcObject;})
    return video
}

client.deleteVideoElement = function (participantID) {
    document.getElementById("participant-" + participantID).outerHTML = "";
}

client.addPeerconnectionListeners = function (pc, participantID) {
    pc.oniceconnectionstatechange = () => {
        console.log(participantID, "oniceconnectionstatechange:", pc.iceConnectionState);
    }

    pc.onicegatheringstatechange = () => {
        console.log(participantID, "onicegatheringstatechange:", pc.iceGatheringState);
    }

    pc.onnegotiationneeded = (event) => {
        console.log(participantID, "onnegotiationneeded");
    }
}

client.addDatachannelListeners = function(datachannel, participantID) {
    datachannel.onopen = function(event) {
        console.log(participantID, "datachannel state: open");
    }
    datachannel.onmessage = function(event) {
        console.log(participantID, "datachannel message: ", event.data);
    }
    datachannel.onclose = function(event) {
        console.log(participantID, "datachannel state: closed");
    }
    datachannel.onerror = function(error) {
        console.log(participantID, "datachannel error");
    }
}