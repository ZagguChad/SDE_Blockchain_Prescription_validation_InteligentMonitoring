import { useState, useEffect, useRef } from 'react';

const VoiceAssistant = ({ onTranscript, onStatusChange }) => {
    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState('');
    const recognitionRef = useRef(null);

    useEffect(() => {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const rec = new SpeechRecognition();
            rec.continuous = true; // Keep listening
            rec.interimResults = true; // Show results immediately
            rec.lang = 'en-US';

            rec.onstart = () => {
                setIsListening(true);
                if (onStatusChange) onStatusChange('Listening...');
            };

            rec.onend = () => {
                setIsListening(false);
                if (onStatusChange) onStatusChange('Mic stopped.');
            };

            rec.onresult = (event) => {
                let finalTranscript = '';
                let currentInterim = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript + ' ';
                    } else {
                        currentInterim += event.results[i][0].transcript;
                    }
                }

                setInterimText(currentInterim);

                // If we have final text, send it up. 
                // We might want to send interim too if we want "live" parsing, 
                // but usually parsing requires stable text.
                // Let's send a combo for the parent to display.
                if (finalTranscript || currentInterim) {
                    // We send the latest chunk of final + current interim
                    // Note: Ideally parent manages full state, but here we just stream chunks
                    if (onTranscript) onTranscript(finalTranscript, currentInterim);
                }
            };

            rec.onerror = (event) => {
                console.error(event.error);
                if (event.error === 'no-speech') return;
                setIsListening(false);
                if (onStatusChange) onStatusChange('Error: ' + event.error);
            };

            recognitionRef.current = rec;
        } else {
            if (onStatusChange) onStatusChange('Speech API not supported.');
        }
    }, [onTranscript, onStatusChange]);

    const toggleListen = (e) => {
        e.preventDefault();
        const rec = recognitionRef.current;
        if (!rec) return;

        if (isListening) {
            rec.stop();
        } else {
            rec.start();
        }
    };

    if (!recognitionRef.current) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <button
                type="button"
                onClick={toggleListen}
                className="btn animate-fade"
                style={{
                    background: isListening ? '#ef4444' : 'var(--primary)',
                    borderRadius: '50%',
                    width: '60px',
                    height: '60px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isListening ? '0 0 20px #ef4444' : 'var(--shadow-md)',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isListening ? 'scale(1.1)' : 'scale(1)'
                }}
                title={isListening ? "Stop Recording" : "Start Voice Input"}
            >
                {isListening ? (
                    <span style={{ fontSize: '1.8rem', animation: 'pulse 1.5s infinite' }}>⏹</span>
                ) : (
                    <span style={{ fontSize: '1.8rem' }}>🎙️</span>
                )}
            </button>
            {isListening && interimText && (
                <div style={{
                    maxWidth: '300px',
                    fontSize: '0.9rem',
                    color: 'var(--accent)',
                    textAlign: 'center',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '0.5rem',
                    borderRadius: '8px',
                    marginTop: '0.5rem'
                }}>
                    "{interimText}..."
                </div>
            )}
        </div>
    );
};

export default VoiceAssistant;
