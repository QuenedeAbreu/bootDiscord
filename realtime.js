let io = null; module.exports = { setIO: (i) => { io = i }, emit: (event, payload) => { if (io) io.emit(event, payload) } };
