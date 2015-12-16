dictatemp3.js
==========

__dictatemp3.js__ is a small Javascript library for browser-based real-time speech recognition.
It uses [recordermp3.js](https://github.com/kdavis-mozilla/recordermp3.js) for audio capture,
and a WebSocket connection to the
[Kaldi DNN GStreamer server](https://github.com/alumae/kaldi-gstreamer-server) for speech recognition.

Quick Start
---

When installed __dictatemp3.js__ exposes the classes ```Dictate``` and ```Transcription```. The following snippet is an example of their use

```Javascript
// Create Transcription to hold utterance
var transcription = new Transcription();

// Create Dictate for speech-to-text
var dictate = new Dictate({
  server: 'ws://<server ip>:8888/client/ws/speech',
  serverStatus: 'ws://<server ip>:8888/client/ws/status',
  referenceHandler: 'ws://<server ip>:8888/client/dynamic/reference',
  mp3RecorderWorkerPath: 'vendor/recordermp3.js/js/enc/mp3/mp3Worker.js',
  onReadyForSpeech: function() {
    dictate.isConnected = true;
    console.info('Ready for speech');
  },
  onEndOfSpeech: function() {
    console.info('End of speech');
  },
  onEndOfSession: function() {
    dictate.isConnected = false;
    console.info('End of session');
  },
  onServerStatus: function(json) {
    if (json.num_workers_available == 0 && !dictate.isConnected) {
      console.info('Waiting');
    }  else {
      console.info('Ready');
    }
  },
  onPartialResults: function(hypos) {
    transcription.add(hypos[0].transcript, false); // TODO: Generalize to more results
    console.info('onPartialResults: ' + transcription.toString());
  },
  onResults: function(hypos) {
    transcription.add(hypos[0].transcript, true); // TODO: Generalize to more results
    console.info('onResults: ' + transcription.toString());
    transcription = new Transcription();
  },
  onError: function(code, data) {
    dictate.cancel();
    console.warn('ERROR: ' + code + ': ' + (data || '')); 
  },
  onEvent: function(code, data) {
    console.info('EVENT: ' + code + ': ' + (data || '')); 
  }
});

// Init dictate.isConnected
dictate.isConnected = false;

// Init Dictate
dictate.init();
```

To see a fuller example refer to [iris](https://github.com/kdavis-mozilla/iris) in particular [main.js](https://github.com/kdavis-mozilla/iris/blob/master/public/js/main.js).

API
---

The API is modelled after [Android's SpeechRecognizer](http://developer.android.com/reference/android/speech/SpeechRecognizer.html).
See the source code of [lib/dictate.js](lib/dictate.js).

Browser support
---------------

Known to work in
  - Firefox 45.0a1 on OSX desktop

See also
--------

- [Kõnele](https://github.com/Kaljurand/K6nele) contains an Android front-end to the Kaldi GStreamer server
