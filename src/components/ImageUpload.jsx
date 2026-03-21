import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';

const ACCEPTED_TYPES = { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'] };

/**
 * ImageUpload — Drag-and-drop + camera capture for handwritten math.
 * Offers: File upload OR webcam access
 */
export default function ImageUpload({ onUpload, isProcessing = false, preview }) {
  const [error, setError] = useState('');
  const [showWebcam, setShowWebcam] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // Cleanup stream on unmount or when closing webcam
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startWebcam = async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setShowWebcam(true);
    } catch (err) {
      setError(`❌ Could not access camera: ${err.message}`);
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowWebcam(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      const video = videoRef.current;
      canvasRef.current.width = video.videoWidth;
      canvasRef.current.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      
      canvasRef.current.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' });
          onUpload(file);
          stopWebcam();
        }
      }, 'image/jpeg');
    }
  };

  const onDrop = useCallback((accepted, rejected) => {
    setError('');
    if (rejected.length > 0) {
      const reasons = rejected[0].errors.map((e) => e.message).join(', ');
      setError(`❌ Invalid file: ${reasons}. Only image files (PNG, JPG, JPEG, WebP, BMP) are accepted.`);
      return;
    }
    if (accepted.length > 0) {
      const file = accepted[0];
      if (!file.type.startsWith('image/')) {
        setError('❌ This is not an image file. Please upload a photo of your handwritten math.');
        return;
      }
      onUpload(file);
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    disabled: isProcessing,
    maxSize: 10 * 1024 * 1024,
    onDropRejected: (fileRejections) => {
      const msg = fileRejections[0]?.errors?.[0]?.message || 'File not accepted';
      setError(`❌ ${msg}. Only image files under 10 MB are allowed.`);
    },
  });

  return (
    <div className={`image-upload ${isDragActive ? 'drag-active' : ''} ${isProcessing ? 'processing' : ''}`}>
      {showWebcam ? (
        <div className="webcam-container">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="webcam-video"
            style={{ width: '100%', borderRadius: '8px', marginBottom: '8px' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="webcam-buttons">
            <button className="panel-btn primary" onClick={capturePhoto}>
              📸 Capture Photo
            </button>
            <button className="panel-btn" onClick={stopWebcam}>
              ✕ Close Camera
            </button>
          </div>
        </div>
      ) : preview ? (
        <div className="preview-container">
          <img src={preview} alt="Uploaded math" className="preview-image" />
          {isProcessing && (
            <div className="processing-overlay">
              <div className="spinner" />
              <span>Analyzing handwriting...</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div {...getRootProps()} className="dropzone">
            <input {...getInputProps()} />
            <div className="upload-prompt">
              <span className="upload-icon">📷</span>
              <p className="upload-title">
                {isDragActive ? 'Drop your image here!' : 'Upload Handwritten Math'}
              </p>
              <p className="upload-subtitle">
                Drag & drop an image, or click to browse
              </p>
              <p className="upload-formats">Accepts: PNG, JPG, JPEG, WebP, BMP</p>
            </div>
          </div>
          <button 
            className="panel-btn webcam-btn" 
            onClick={startWebcam}
            disabled={isProcessing}
            style={{ marginTop: '12px' }}
          >
            📹 Or use Camera
          </button>
        </>
      )}
      {error && <div className="upload-error">{error}</div>}
    </div>
  );
}
