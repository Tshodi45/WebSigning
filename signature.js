// Define the Wacom STU-540 WebHID Driver class
var wacomstu540 = function () {
    if (navigator == null || navigator.hid == null) return null;

    // Configuration settings
    this.config = {
        chunkSize: 253,
        vid: 1386,
        pid: 168,
        imageFormat24BGR: 0x04,
        width: 800,
        height: 480,
        scaleFactor: 13.5,
        pressureFactor: 1023,
        refreshRate: 0,
        tabletWidth: 0,
        tabletHeight: 0,
        deviceName: null,
        firmware: null,
        eSerial: null,
        onPenDataCb: null,
        onHidChangeCb: null,
    };

    this.command = {
        penData: 0x01,
        information: 0x08,
        capability: 0x09,
        writingMode: 0x0E,
        eSerial: 0x0F,
        clearScreen: 0x20,
        inkMode: 0x21,
        writeImageStart: 0x25,
        writeImageData: 0x26,
        writeImageEnd: 0x27,
        writingArea: 0x2A,
        brightness: 0x2B,
        backgroundColor: 0x2E,
        penColorAndWidth: 0x2D,
        penDataTiming: 0x34,
    };

    this.device = null;
    this.image = null;

    this.checkAvailable = async function () {
        if (this.checkConnected()) return true;
        let devices = await navigator.hid.getDevices();
        for (let i = 0; i < devices.length; i++) {
            let device = devices[i];
            if (device.vendorId == this.config.vid && device.productId == this.config.pid)
                return true;
        }
        return false;
    }.bind(this);

    this.connect = async function () {
        if (this.checkConnected()) return;
        let dev = await navigator.hid.requestDevice({ filters: [{ vendorId: this.config.vid, productId: this.config.pid }] });
        if (dev[0] == null) return false;
        this.device = dev[0];
        await this.device.open();
        this.device.addEventListener("inputreport", async function (event) {
            if (this.config.onPenDataCb == null) return;
            if (event.reportId == this.command.penData || event.reportId == this.command.penDataTiming) {
                let packet = {
                    rdy: (event.data.getUint8(0) & (1 << 0)) !== 0,
                    sw: (event.data.getUint8(0) & (1 << 1)) !== 0,
                    cx: Math.trunc(event.data.getUint16(2) / this.config.scaleFactor),
                    cy: Math.trunc(event.data.getUint16(4) / this.config.scaleFactor),
                    x: event.data.getUint16(2),
                    y: event.data.getUint16(4),
                    press: 0,
                    seq: null,
                    time: null,
                };
                event.data.setUint8(0, event.data.getUint8(0) & 0x0F);
                packet.press = event.data.getUint16(0) / this.config.pressureFactor;
                if (event.reportId == this.command.penDataTiming) {
                    packet.time = event.data.getUint16(6);
                    packet.seq = event.data.getUint16(8);
                }
                this.config.onPenDataCb(packet);
            }
        }.bind(this));
        let dv = await this.readData(this.command.capability);
        this.config.tabletWidth = dv.getUint16(1);
        this.config.tabletHeight = dv.getUint16(3);
        this.config.pressureFactor = dv.getUint16(5);
        this.config.width = dv.getUint16(7);
        this.config.height = dv.getUint16(9);
        this.config.refreshRate = dv.getUint8(11);
        this.config.scaleFactor = this.config.tabletWidth / this.config.width;
        dv = await this.readData(this.command.information);
        this.config.deviceName = this.dataViewString(dv, 1, 7);
        this.config.firmware = dv.getUint8(8) + "." + dv.getUint8(9) + "." + dv.getUint8(10) + "." + dv.getUint8(11);
        dv = await this.readData(this.command.eSerial);
        this.config.eSerial = this.dataViewString(dv, 1);
        return true;
    }.bind(this);

    this.getTabletInfo = function () {
        if (!this.checkConnected()) return;
        return this.config;
    }.bind(this);

    this.setPenColorAndWidth = async function (color, width) {
        if (!this.checkConnected()) return;
        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16));
        c.push(parseInt(width));
        await this.sendData(this.command.penColorAndWidth, new Uint8Array(c));
    }.bind(this);

    this.setBacklight = async function (intensity) {
        if (!this.checkConnected()) return;
        let dv = await this.readData(this.command.brightness);
        if (dv.getUint8(1) == intensity) return;
        await this.sendData(this.command.brightness, new Uint8Array([intensity, 0]));
    }.bind(this);

    this.setBackgroundColor = async function (color) {
        if (!this.checkConnected()) return;
        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16));
        let dv = await this.readData(this.command.backgroundColor);
        if (dv.getUint8(1) == c[0] && dv.getUint8(2) == c[1] && dv.getUint8(3) == c[2]) return;
        await this.sendData(this.command.backgroundColor, new Uint8Array(c));
    }.bind(this);

    this.setWritingArea = async function (p) {
        if (!this.checkConnected()) return;
        let pk = this.makePacket(8);
        pk.view.setUint16(0, p.x1, true);
        pk.view.setUint16(2, p.y1, true);
        pk.view.setUint16(4, p.x2, true);
        pk.view.setUint16(6, p.y2, true);
        await this.sendData(this.command.writingArea, pk.data);
    }.bind(this);

    this.setWritingMode = async function (mode) {
        if (!this.checkConnected()) return;
        await this.sendData(this.command.writingMode, new Uint8Array([mode]));
    }.bind(this);

    this.setInking = async function (enabled) {
        if (!this.checkConnected()) return;
        await this.sendData(this.command.inkMode, new Uint8Array([enabled ? 1 : 0]));
    }.bind(this);

    this.clearScreen = async function () {
        if (!this.checkConnected()) return;
        await this.sendData(this.command.clearScreen, new Uint8Array([0]));
    }.bind(this);

    this.setImage = async function (imageData) {
        if (!this.checkConnected()) return;
        if (imageData != null)
            this.image = this.splitToBulks(imageData, this.config.chunkSize);
        if (this.image == null) return;
        await this.sendData(this.command.writeImageStart, new Uint8Array([this.config.imageFormat24BGR]));
        this.image.forEach(async function (e) {
            await this.sendData(this.command.writeImageData, new Uint8Array([e.length, 0].concat(e)));
        }.bind(this));
        await this.sendData(this.command.writeImageEnd, new Uint8Array([0]));
    }.bind(this);

    this.checkConnected = function () {
        return this.device != null && this.device.opened;
    }.bind(this);

    this.sendData = async function (reportId, data) {
        if (!this.checkConnected()) return;
        await this.device.sendFeatureReport(reportId, data);
    }.bind(this);

    this.readData = async function (reportId) {
        if (!this.checkConnected()) return null;
        return await this.device.receiveFeatureReport(reportId);
    }.bind(this);

    this.dataViewString = function (dataView, from, to) {
        if (to == null) to = dataView.byteLength;
        return String.fromCharCode.apply(null, new Uint8Array(dataView.buffer, from, to - from));
    }

    this.makePacket = function (size) {
        let dv = new DataView(new ArrayBuffer(size));
        let data = new Uint8Array(size);
        return { data: data, view: dv };
    }

    this.splitToBulks = function (data, size) {
        let bulks = [];
        let pos = 0;
        while (pos < data.length) {
            bulks.push(data.slice(pos, pos += size));
        }
        return bulks;
    }
};

// Initialize variables
let tablet;
let canvas, ctx;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// Set up the canvas and context
function setupCanvas() {
    canvas = document.getElementById('signatureCanvas');
    ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    document.getElementById('clearButton').addEventListener('click', clearCanvas);
    document.getElementById('submitButton').addEventListener('click', submitSignature);
    document.getElementById('connectButton').addEventListener('click', connectDevice);
}

// Start drawing on the canvas
function startDrawing(event) {
    isDrawing = true;
    lastX = event.offsetX;
    lastY = event.offsetY;
}

// Draw on the canvas
function draw(event) {
    if (!isDrawing) return;

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(event.offsetX, event.offsetY);
    ctx.stroke();

    lastX = event.offsetX;
    lastY = event.offsetY;
}

// Stop drawing on the canvas
function stopDrawing() {
    isDrawing = false;
}

// Clear the canvas
function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Submit the signature
function submitSignature() {
    let dataURL = canvas.toDataURL('image/png');
    console.log('Signature Data URL:', dataURL);
}





// Connect to the Wacom device
async function connectDevice() {
    try {
        if (tablet == null) {
            tablet = new wacomstu540();
        }

        let isAvailable = await tablet.checkAvailable();
        if (!isAvailable) {
            console.log('No Wacom device available.');
            return;
        }

        let connected = await tablet.connect();
        if (connected) {
            console.log('Connected to Wacom device.');
        } else {
            console.log('Failed to connect to Wacom device.');
        }

        tablet.config.onPenDataCb = function (data) {
            if (data.sw) {
                drawPenData(data);
            }
        };
    } catch (error) {
        console.error('Error connecting to Wacom device:', error);
    }
}

// Draw pen data on the canvas
function drawPenData(data) {
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(data.cx, data.cy);
    ctx.stroke();

    lastX = data.cx;
    lastY = data.cy;
}

// Run the initialization
window.onload = setupCanvas;
