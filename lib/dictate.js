(function(window){

  // Defaults
  var SERVER = "ws://52.27.131.95:8888/client/ws/speech";
  var SERVER_STATUS = "ws://52.27.131.95:8888/client/ws/status";
  var REFERENCE_HANDLER = "ws://52.27.131.95:8888/client/dynamic/reference";
  var WAV_RECORDER_WORKER_PATH = 'recorderWorker.js';
  var MP3_RECORDER_WORKER_PATH = 'mp3Worker.js';
  var TAG_END_OF_SENTENCE = "EOS";
  var INTERVAL = 250;
  var BYTE_RATE = 8192;

  // Error codes (mostly following Android error names and codes)
  var ERR_NETWORK = 2;
  var ERR_AUDIO = 3;
  var ERR_SERVER = 4;
  var ERR_CLIENT = 5;

  // Event codes
  var MSG_WAITING_MICROPHONE = 1;
  var MSG_MEDIA_STREAM_CREATED = 2;
  var MSG_INIT_RECORDER = 3;
  var MSG_RECORDING = 4;
  var MSG_SEND = 5;
  var MSG_SEND_EMPTY = 6;
  var MSG_SEND_EOS = 7;
  var MSG_WEB_SOCKET = 8;
  var MSG_WEB_SOCKET_OPEN = 9;
  var MSG_WEB_SOCKET_CLOSE = 10;
  var MSG_STOP = 11;
  var MSG_SERVER_CHANGED = 12;

  // Server status codes
  // from https://github.com/alumae/kaldi-gstreamer-server
  var SERVER_STATUS_CODE = {
    0: 'Success', // Usually used when recognition results are sent
    1: 'No speech', // Incoming audio contained a large portion of silence or non-speech
    2: 'Aborted', // Recognition was aborted for some reason
    9: 'No available', // recognizer processes are currently in use and recognition cannot be performed
  };

  var Dictate = function(cfg) {
    var config = cfg || {};
    config.byteRate = config.byteRate || BYTE_RATE;
    config.interval = config.interval || INTERVAL;
    config.server = config.server || SERVER;
    config.serverStatus = config.serverStatus || SERVER_STATUS;
    config.referenceHandler = config.referenceHandler || REFERENCE_HANDLER;
    config.wavCallback = config.wavCallback || wavCallback;
    config.mp3Callback = config.mp3Callback || mp3Callback;
    config.wavRecorderWorkerPath = config.wavRecorderWorkerPath || WAV_RECORDER_WORKER_PATH;
    config.mp3RecorderWorkerPath = config.mp3RecorderWorkerPath || MP3_RECORDER_WORKER_PATH;
    config.onPartialResults = config.onPartialResults || function(data) {};
    config.onResults = config.onResults || function(data) {};
    config.onEndOfSession = config.onEndOfSession || function() {};
    config.onEvent = config.onEvent || function(e, data) {};
    config.onError = config.onError || function(e, data) {};
    config.rafCallback = config.rafCallback || function(time) {};
    if (config.onServerStatus) {
      monitorServerStatus();
    }

    // Initialized by init()
    var audioContext;
    var recorder;
    // Initialized by startListening()
    var ws;
    var intervalKey;
    // Initialized during construction
    var wsServerStatus;

    // Returns the configuration
    this.getConfig = function() {
      return config;
    }

    // Set up the recorder (incl. asking permission)
    // Initializes audioContext
    // Can be called multiple times.
    // TODO: call something on success (MSG_INIT_RECORDER is currently called)
    this.init = function() {
      var audioSourceConstraints = {};
      config.onEvent(MSG_WAITING_MICROPHONE, "Waiting for approval to access your microphone ...");
      try {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
        window.URL = window.URL || window.webkitURL;
        audioContext = new AudioContext();
      } catch (e) {
        // Firefox 24: TypeError: AudioContext is not a constructor
        // Set media.webaudio.enabled = true (in about:config) to fix this.
        config.onError(ERR_CLIENT, "Error initializing Web Audio browser: " + e);
      }

      if (navigator.getUserMedia) {
        audioSourceConstraints.audio = true;
        navigator.getUserMedia(audioSourceConstraints, startUserMedia, function(e) {
          config.onError(ERR_CLIENT, "No live audio input in this browser: " + e);
        });
      } else {
        config.onError(ERR_CLIENT, "No user media support");
      }
    }

    // Start recording and transcribing
    this.startListening = function() {
      if (!recorder) {
        config.onError(ERR_AUDIO, "Recorder undefined");
        return;
      }

      if (ws) {
        cancel();
      }

      try {
        ws = createWebSocket();
      } catch (e) {
        config.onError(ERR_CLIENT, "No web socket support in this browser!");
      }
    }

    // Stop listening, i.e. recording and sending of new input.
    this.stopListening = function() {
      // Stop recording
      if (recorder) {
        recorder.stop();
        config.onEvent(MSG_STOP, 'Stopped recording');
        config.onEndOfSpeech();
      } else {
        config.onError(ERR_AUDIO, "Recorder undefined");
      }
    }

    // Cancel everything without waiting on the server
    this.cancel = function() {
      // Stop the regular sending of audio (if present)
      clearInterval(intervalKey);
      if (recorder) {
        recorder.stop();
        config.onEvent(MSG_STOP, 'Stopped recording');
      }
      if (ws) {
        ws.close();
        ws = null;
      }
    }

    // Sets the URL of the speech server
    this.setServer = function(server) {
      config.server = server;
      config.onEvent(MSG_SERVER_CHANGED, 'Server changed: ' + server);
    }

    // Sets the URL of the speech server status server
    this.setServerStatus = function(serverStatus) {
      config.serverStatus = serverStatus;

      if (config.onServerStatus) {
        monitorServerStatus();
      }

      config.onEvent(MSG_SERVER_CHANGED, 'Server status server changed: ' + serverStatus);
    }

    // Sends reference text to speech server
    this.submitReference = function submitReference(text, successCallback, errorCallback) {
      var headers = {}
      $.ajax({
        url: config.referenceHandler,
        type: "POST",
        headers: headers,
        data: text,
        dataType: "text",
        success: successCallback,
        error: errorCallback,
      });  
    }

    // Private methods
    function startUserMedia(stream) {
      var input = audioContext.createMediaStreamSource(stream);
      config.onEvent(MSG_MEDIA_STREAM_CREATED, 'Media stream created');

      // make the analyser available in window context
      window.userSpeechAnalyser = audioContext.createAnalyser();
      input.connect(window.userSpeechAnalyser);

      config.rafCallback();

      recorder = new Recorder(input, {
                              wavCallback : config.wavCallback,
                              mp3Callback : config.mp3Callback,
                              wavWorkerPath : config.wavRecorderWorkerPath,
                              mp3WorkerPath : config.mp3RecorderWorkerPath
                             });
      config.onEvent(MSG_INIT_RECORDER, 'Recorder initialized');
    }

    function createWebSocket() {
      // TODO: do we need to use a protocol?
      //var ws = new WebSocket("ws://127.0.0.1:8081", "echo-protocol");
      var url = config.server + '?content-type=';
      var ws = new WebSocket(url);

      ws.onmessage = function(e) {
        var data = e.data;
        config.onEvent(MSG_WEB_SOCKET, data);
        if (data instanceof Object && !(data instanceof Blob)) {
          config.onError(ERR_SERVER, 'WebSocket: onEvent: got Object that is not a Blob');
        } else if (data instanceof Blob) {
          config.onError(ERR_SERVER, 'WebSocket: got Blob');
        } else {
          var res = JSON.parse(data);
          if (res.status == 0) {
            if (res.result) {
              if (res.result.final) {
                config.onResults(res.result.hypotheses);
              } else {
                config.onPartialResults(res.result.hypotheses);
              }
            }
          } else {
            config.onError(ERR_SERVER, 'Server error: ' + res.status + ': ' + getDescription(res.status));
          }
        }
      }

      // Start recording only if the socket becomes open
      ws.onopen = function(e) {
        // Start recording
        recorder.record();
        config.onReadyForSpeech();
        config.onEvent(MSG_WEB_SOCKET_OPEN, e);
      };

      // This can happen if the blob was too big
      // E.g. "Frame size of 65580 bytes exceeds maximum accepted frame size"
      // Status codes
      // http://tools.ietf.org/html/rfc6455#section-7.4.1
      // 1005:
      // 1006:
      ws.onclose = function(e) {
        var code = e.code;
        var reason = e.reason;
        var wasClean = e.wasClean;
        // The server closes the connection (only?) when its endpointer triggers.
        config.onEndOfSession();
        config.onEvent(MSG_WEB_SOCKET_CLOSE, e.code + "/" + e.reason + "/" + e.wasClean);
      };

      ws.onerror = function(e) {
        var data = e.data;
        config.onError(ERR_NETWORK, data);
      }

      return ws;
    }


    function monitorServerStatus() {
      if (wsServerStatus) {
        wsServerStatus.close();
      }
      wsServerStatus = new WebSocket(config.serverStatus);
      wsServerStatus.onmessage = function(evt) {
        config.onServerStatus(JSON.parse(evt.data));
      };
    }


    function getDescription(code) {
      if (code in SERVER_STATUS_CODE) {
        return SERVER_STATUS_CODE[code];
      }
      return "Unknown error";
    }

    function wavCallback(blob) {
    }

    function mp3Callback(blob) {
      // Start regular sending of audio
      var bufferLength = (BYTE_RATE / (1000/config.interval));
      var start = 0;
      var stop = bufferLength;
      intervalKey = setInterval(function() {
          if (start < blob.size) {
            var currentStop = ((stop <= blob.size) ? stop : blob.size);
            var currentBlob = blob.slice(start,currentStop);
            socketSend(currentBlob);
            start = stop;
            stop = stop + bufferLength; 
          } else {
            socketSend(TAG_END_OF_SENTENCE);
          }
        },
        config.interval
      );
    }

    function socketSend(item) {
      if (ws) {
        var state = ws.readyState;
        if (state == 1) {
          // If item is an audio blob
          if (item instanceof Blob) {
            if (item.size > 0) {
              ws.send(item);
              config.onEvent(MSG_SEND, 'Send: blob: ' + item.type + ', ' + item.size);
            } else {
              config.onEvent(MSG_SEND_EMPTY, 'Send: blob: ' + item.type + ', EMPTY');
            }
          // Otherwise it's the EOS tag (string)
          } else {
            ws.send(item);
            clearInterval(intervalKey)
            config.onEvent(MSG_SEND_EOS, 'Send tag: ' + item);
          }
        } else {
          config.onError(ERR_NETWORK, 'WebSocket: readyState!=1: ' + state + ": failed to send: " + item);
        }
      } else {
        config.onError(ERR_CLIENT, 'No web socket connection: failed to send: ' + item);
      }
    }
  };

  // Simple class for persisting the transcription.
  // If isFinal==true then a new line is started in the transcription list
  // (which only keeps the final transcriptions).
  var Transcription = function(cfg) {
    var index = 0;
    var list = [];

    this.add = function(text, isFinal) {
      list[index] = text;
      if (isFinal) {
        index++;
      }
    }

    this.toString = function() {
      return list.join('. ');
    }
  }

  window.Dictate = Dictate;
  window.Transcription = Transcription;

})(window);
