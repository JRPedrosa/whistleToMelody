let audioContext,
  analyser,
  microphone,
  dataArray,
  stream,
  mediaRecorder,
  recordedChunks;
let isCapturing = false;

const startButton = document.getElementById('startButton');
const noteDisplay = document.getElementById('noteDisplay');
const volumeDisplay = document.getElementById('volumeDisplay');
const canvas = document.getElementById('canvas');
const canvasContext = canvas.getContext('2d');
const audioContainer = document.getElementById('audioContainer'); // This is where audio will be appended

canvas.width = window.innerWidth; // Full width
canvas.height = 300; // Fixed height for visualization

const toggleCapture = async () => {
  if (!isCapturing) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      microphone = audioContext.createMediaStreamSource(stream);

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 5.0; // Amplify input by 5x

      microphone.connect(gainNode);
      gainNode.connect(analyser);

      dataArray = new Uint8Array(analyser.frequencyBinCount); // Changed to Uint8Array

      // Create MediaRecorder to capture audio and store it
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) =>
        recordedChunks.push(event.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(recordedChunks, { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        const audioElement = document.createElement('audio');
        audioElement.src = audioUrl;
        audioElement.controls = true;

        // Remove any existing audio elements from the container
        const existingAudio = audioContainer.querySelector('audio');
        if (existingAudio) {
          existingAudio.remove(); // Remove the previous audio element
        }

        // Append the new audio element
        audioContainer.appendChild(audioElement);

        // Process the recorded audio file
        const audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
        const audioBuffer = await loadAudioBuffer(audioBlob, audioContext);
        const notesDetected = await analyzeAudioForNotes(
          audioBuffer,
          audioContext,
        );

        console.log(notesDetected); // Array of { time: <time>, note: <note> }
      };

      mediaRecorder.start(); // Start recording

      isCapturing = true;
      startButton.innerText = 'Stop Capturing';
      detectPitch();
    } catch (err) {
      console.error('Error accessing microphone:', err);
      noteDisplay.innerText = 'Microphone access denied.';
    }
  } else {
    stopCapture();
  }
};

const loadAudioBuffer = (audioBlob, audioContext) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      audioContext.decodeAudioData(event.target.result, resolve, reject);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(audioBlob);
  });
};

const analyzeAudioForNotes = (audioBuffer, audioContext) => {
  return new Promise((resolve) => {
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    // Set up AnalyserNode properties
    analyser.fftSize = 2048; // Size of the FFT (Frequency Domain Size)
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Connect the nodes
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    // Start the audio playback
    // source.start();

    const notesDetected = [];
    let currentTime = 0;

    const detectNotes = () => {
      if (currentTime >= audioBuffer.duration) {
        source.stop(); // Stop once the entire buffer has been analyzed
        resolve(notesDetected);
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      // Find the dominant frequency
      const frequency = getDominantFrequency(
        dataArray,
        audioContext.sampleRate,
      );

      // Convert frequency to note
      if (frequency) {
        const note = frequencyToNote(frequency);
        notesDetected.push({ time: currentTime, note });
      }

      currentTime += 0.05; // Increment by a fixed time step (e.g., every 50 ms)

      setTimeout(detectNotes, 50); // Recursively analyze at intervals
    };

    detectNotes();
  });
};

const detectPitch = () => {
  if (!isCapturing) return;

  analyser.getByteFrequencyData(dataArray); // Using Uint8Array

  // Calculate volume with increased sensitivity
  const volume = getVolumeIntensity(dataArray);
  const volumePercentage = Math.min(volume * 1000, 100); // Amplified for better visibility
  volumeDisplay.innerText = `Volume Intensity: ${volumePercentage.toFixed(2)}%`;

  // Lower threshold for frequency detection
  const frequency = getDominantFrequency(dataArray, audioContext.sampleRate);
  if (frequency && frequency > 20 && frequency < 8000) {
    const note = frequencyToNote(frequency);
    noteDisplay.innerText = `Detected Note: ${note} (${frequency.toFixed(
      1,
    )} Hz)`;
  }

  // Draw pitch graph on the canvas
  drawPitchGraph();

  requestAnimationFrame(detectPitch);
};

const stopCapture = () => {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (audioContext) {
    audioContext.close();
  }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop(); // Stop recording when done capturing
  }
  isCapturing = false;
  startButton.innerText = 'Start Capturing';
  noteDisplay.innerText = 'Detected Note: -';
  volumeDisplay.innerText = 'Volume Intensity: -';
};

const getVolumeIntensity = (data) => {
  let sumSquares = 0;
  data.forEach((value) => {
    sumSquares += value * value;
  });
  return Math.sqrt(sumSquares / data.length);
};

const getDominantFrequency = (data) => {
  let maxAmplitude = -Infinity; // Start with the lowest possible value
  let dominantFrequency = -1;

  // Loop through the frequency data to find the peak frequency
  for (let i = 0; i < data.length; i++) {
    const amplitude = data[i];
    if (amplitude > maxAmplitude) {
      maxAmplitude = amplitude;
      dominantFrequency = (i * audioContext.sampleRate) / analyser.fftSize; // Convert index to frequency
    }
  }

  // Return the frequency if it's within the human range
  if (dominantFrequency > 20 && dominantFrequency < 8000) {
    return dominantFrequency;
  }

  return null;
};

const frequencyToNote = (freq) => {
  const A4 = 440;
  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];
  const midi = Math.round(69 + 12 * Math.log2(freq / A4));
  if (midi < 0 || midi > 127) return 'Out of Range';
  return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
};

const drawPitchGraph = () => {
  canvasContext.clearRect(0, 0, canvas.width, canvas.height); // Clear previous frame
  canvasContext.fillStyle = 'rgba(0, 0, 0, 0.1)';
  canvasContext.fillRect(0, 0, canvas.width, canvas.height); // Light background for better contrast

  analyser.getByteFrequencyData(dataArray);
  const width = canvas.width;
  const barWidth = width / dataArray.length;

  dataArray.forEach((value, index) => {
    const height = (value / 255) * canvas.height;
    canvasContext.fillStyle = 'rgba(0, 0, 255, 0.7)';
    canvasContext.fillRect(
      index * barWidth,
      canvas.height - height,
      barWidth,
      height,
    );
  });
};

startButton.addEventListener('click', toggleCapture);
