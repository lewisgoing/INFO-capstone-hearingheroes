"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, X, Headphones, Volume2, Volume1, VolumeX, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const playerData = {
  song: {
    name: "They Say It's Wonderful",
    author: "John Coltrane and Johnny Hartman",
    cover: "https://i.scdn.co/image/ab67616d0000b2731d1cc2e40d533d7bcebf5dae",
    // Use a direct accessible mp3 URL that should be more reliable
    audio: "https://storage.googleapis.com/media-session/elephants-dream/the-wires.mp3",
  },
};

// Define preset types
type PresetType = "flat" | "bassBoost" | "vocalEnhancer" | "trebleBoost";
type ChannelMode = "stereo" | "mono";
type SoloMode = "none" | "left" | "right";

// EQ settings for presets
const presetValues: Record<PresetType, number[]> = {
  flat: [0, 0, 0],
  bassBoost: [20, -3, -10], // Extremely strong bass, reduced mids and treble
  vocalEnhancer: [-10, 15, 5], // Very pronounced vocals with reduced bass
  trebleBoost: [-15, -5, 20], // Extremely bright sound, heavily reduced bass
};

export function MusicPlayer() {
  // EQ and audio routing state
  const [isEQEnabled, setIsEQEnabled] = useState(true);
  const [isSplitEarMode, setIsSplitEarMode] = useState(false);
  // Track if split mode has been initialized
  const [splitModeInitialized, setSplitModeInitialized] = useState(false);
  
  // Unified mode state
  const [unifiedPreset, setUnifiedPreset] = useState<PresetType>("flat");
  
  // Split mode state (maintained independently)
  const [leftEarPreset, setLeftEarPreset] = useState<PresetType>("flat");
  const [rightEarPreset, setRightEarPreset] = useState<PresetType>("flat");
  
  const [balance, setBalance] = useState(0.5); // 0 = full left, 1 = full right, 0.5 = center
  const [channelMode, setChannelMode] = useState<ChannelMode>("stereo");
  const [soloMode, setSoloMode] = useState<SoloMode>("none");

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isAudioLoaded, setIsAudioLoaded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioInitialized, setAudioInitialized] = useState(false);

  // Add state to track previous preset values for smooth transitions
  const [prevUnifiedPreset, setPrevUnifiedPreset] = useState<PresetType>("flat");
  const [prevLeftEarPreset, setPrevLeftEarPreset] = useState<PresetType>("flat");
  const [prevRightEarPreset, setPrevRightEarPreset] = useState<PresetType>("flat");
  
  // Track animation progress for smooth transitions
  const [transitionProgress, setTransitionProgress] = useState(1.0); // 0.0 to 1.0
  const transitionDuration = 150; // ms
  const transitionTimerRef = useRef<number | null>(null);

  // Canvas ref for frequency response
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Audio refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Audio nodes
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const mergerRef = useRef<ChannelMergerNode | null>(null);
  const leftFiltersRef = useRef<BiquadFilterNode[]>([]);
  const rightFiltersRef = useRef<BiquadFilterNode[]>([]);
  const leftGainRef = useRef<GainNode | null>(null);
  const rightGainRef = useRef<GainNode | null>(null);

  // Add requestAnimationFrame ID ref for cancellation
  const animationFrameRef = useRef<number | null>(null);

  // Only load the audio file in the initial setup, don't create audio context yet
  useEffect(() => {
    if (audioRef.current) {
      // Set the source
      audioRef.current.src = playerData.song.audio;
      audioRef.current.crossOrigin = "anonymous";
      
      // Add event listeners
      const canPlayHandler = () => {
        console.log("Audio can play through");
        setIsAudioLoaded(true);
      };
      
      const metadataHandler = () => {
        console.log("Audio metadata loaded, duration:", audioRef.current?.duration);
        setDuration(audioRef.current?.duration || 0);
      };
      
      const errorHandler = (e: Event) => {
        console.error("Audio element error:", e);
        alert("Error loading audio. Please check console for details.");
      };
      
      audioRef.current.addEventListener('canplaythrough', canPlayHandler);
      audioRef.current.addEventListener('loadedmetadata', metadataHandler);
      audioRef.current.addEventListener('error', errorHandler);
      
      // Preload audio
      audioRef.current.load();
      
      // Cleanup function
      return () => {
        if (audioRef.current) {
          audioRef.current.removeEventListener('canplaythrough', canPlayHandler);
          audioRef.current.removeEventListener('loadedmetadata', metadataHandler);
          audioRef.current.removeEventListener('error', errorHandler);
        }
        
        // Cleanup audio context
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(e => console.error("Error closing audio context:", e));
        }

        // Cancel any pending animation frame
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }
  }, []);

  // Handle time updates
  useEffect(() => {
    const audio = audioRef.current;
    
    const updateTimeHandler = () => {
      if (audio) {
        setCurrentTime(audio.currentTime);
        const currentProgress = (audio.currentTime / (audio.duration || 1)) * 100;
        setProgress(currentProgress);
      }
    };

    audio?.addEventListener('timeupdate', updateTimeHandler);
    
    return () => {
      audio?.removeEventListener('timeupdate', updateTimeHandler);
    };
  }, []);

  // Update the visualization when component mounts and whenever critical state changes
  useEffect(() => {
    // Ensure the canvas is properly sized on mount and window resize
    const resizeCanvas = () => {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const container = canvas.parentElement;
        if (container) {
          canvas.width = container.clientWidth;
          canvas.height = container.clientHeight;
          // Update visualization after resize
          updateFrequencyResponse();
        }
      }
    };

    // Set up initial canvas size
    resizeCanvas();
    
    // Listen for window resize events
    window.addEventListener('resize', resizeCanvas);
    
    // Initial visualization
    updateFrequencyResponse();
    
    // Force a redraw after a short delay to ensure all state changes are applied
    // This helps fix the "one frame behind" issue
    const forceRedrawTimeout = setTimeout(() => {
      updateFrequencyResponse();
      
      // For even more aggressive redrawing, we can use a double RAF to ensure
      // the browser has fully processed all updates
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updateFrequencyResponse();
        });
      });
    }, 50);
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      // Cancel any pending animation frame and timeout on unmount
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      clearTimeout(forceRedrawTimeout);
    };
  }, [isEQEnabled, isSplitEarMode, unifiedPreset, leftEarPreset, rightEarPreset]);

  // Update audio routing when EQ is toggled
  useEffect(() => {
    if (audioInitialized) {
      console.log("EQ state changed to:", isEQEnabled ? "enabled" : "disabled");
      
      let updated = false;
      
      // When EQ state changes, directly update the gain values on existing filters
      if (isSplitEarMode) {
        // Apply gain directly to left and right filters
        if (leftFiltersRef.current.length > 0) {
          const values = presetValues[leftEarPreset];
          leftFiltersRef.current.forEach((filter, index) => {
            if (filter && index < values.length) {
              filter.gain.value = isEQEnabled ? values[index] : 0;
              console.log(`Left filter ${index} gain set to:`, filter.gain.value);
              updated = true;
            }
          });
        }
        
        if (rightFiltersRef.current.length > 0) {
          const values = presetValues[rightEarPreset];
          rightFiltersRef.current.forEach((filter, index) => {
            if (filter && index < values.length) {
              filter.gain.value = isEQEnabled ? values[index] : 0;
              console.log(`Right filter ${index} gain set to:`, filter.gain.value);
              updated = true;
            }
          });
        }
      } else {
        // Apply gain directly to unified filters
        if (filtersRef.current.length > 0) {
          const values = presetValues[unifiedPreset];
          filtersRef.current.forEach((filter, index) => {
            if (filter && index < values.length) {
              filter.gain.value = isEQEnabled ? values[index] : 0;
              console.log(`Unified filter ${index} gain set to:`, filter.gain.value);
              updated = true;
            }
          });
        }
      }
      
      // Update visualization immediately if we updated any filters
      if (updated) {
        updateFrequencyResponse();
      }
    }
  }, [isEQEnabled, isSplitEarMode, leftEarPreset, rightEarPreset, unifiedPreset]);

  // Monitor mode changes to ensure proper audio routing
  useEffect(() => {
    if (audioInitialized) {
      console.log("Mode changed to:", isSplitEarMode ? "split" : "unified");
      updateAudioRouting();
    }
  }, [isSplitEarMode]);

  // Function to smoothly interpolate between two EQ presets
  const interpolatePresets = (fromPreset: PresetType, toPreset: PresetType, progress: number): number[] => {
    const fromValues = presetValues[fromPreset];
    const toValues = presetValues[toPreset];
    return fromValues.map((fromValue, index) => {
      const toValue = toValues[index];
      return fromValue + (toValue - fromValue) * progress;
    });
  };
  
  // Start a smooth transition between presets
  const startPresetTransition = (
    fromUnified: PresetType = prevUnifiedPreset,
    toUnified: PresetType = unifiedPreset,
    fromLeft: PresetType = prevLeftEarPreset,
    toLeft: PresetType = leftEarPreset,
    fromRight: PresetType = prevRightEarPreset,
    toRight: PresetType = rightEarPreset
  ) => {
    // Clear any existing transition
    if (transitionTimerRef.current !== null) {
      clearInterval(transitionTimerRef.current);
    }
    
    // Set the starting values
    setPrevUnifiedPreset(fromUnified);
    setPrevLeftEarPreset(fromLeft);
    setPrevRightEarPreset(fromRight);
    
    // Reset transition progress
    setTransitionProgress(0);
    
    // Start a new transition animation
    const startTime = Date.now();
    const updateTransition = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min(elapsed / transitionDuration, 1.0);
      setTransitionProgress(newProgress);
      
      // Update the visualization with the current transition progress
      updateFrequencyResponseWithTransition(newProgress, {
        fromUnified, toUnified,
        fromLeft, toLeft,
        fromRight, toRight
      });
      
      // End the transition when complete
      if (newProgress >= 1.0) {
        if (transitionTimerRef.current !== null) {
          clearInterval(transitionTimerRef.current);
          transitionTimerRef.current = null;
        }
      }
    };
    
    // Run the animation at 60fps
    transitionTimerRef.current = window.setInterval(updateTransition, 1000 / 60);
    
    // Run the first frame immediately
    updateTransition();
  };
  
  // Calculate and update the frequency response curve with transition animation
  const updateFrequencyResponseWithTransition = (
    progress: number,
    transitionPresets: {
      fromUnified: PresetType,
      toUnified: PresetType,
      fromLeft: PresetType,
      toLeft: PresetType,
      fromRight: PresetType,
      toRight: PresetType
    }
  ) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid (same as in updateFrequencyResponse)
    // ... (grid drawing code) ...
    const gridColor = '#e9ecef';
    const gridLines = 12;
    const gridSpacingH = canvas.width / gridLines;
    const gridSpacingV = canvas.height / gridLines;
    
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= gridLines; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * gridSpacingV);
      ctx.lineTo(canvas.width, i * gridSpacingV);
      ctx.stroke();
    }
    
    // Vertical grid lines
    for (let i = 0; i <= gridLines; i++) {
      ctx.beginPath();
      ctx.moveTo(i * gridSpacingH, 0);
      ctx.lineTo(i * gridSpacingH, canvas.height);
      ctx.stroke();
    }
    
    // Draw zero line with a different color
    ctx.strokeStyle = '#ced4da';
    ctx.lineWidth = 2;
    const zeroDbY = canvas.height / 2;
    ctx.beginPath();
    ctx.moveTo(0, zeroDbY);
    ctx.lineTo(canvas.width, zeroDbY);
    ctx.stroke();
    
    // Add frequency labels
    ctx.fillStyle = '#6c757d';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    
    const freqLabels = ['20Hz', '100Hz', '1kHz', '5kHz', '20kHz'];
    const freqPositions = [0.05, 0.25, 0.5, 0.75, 0.95];
    
    freqLabels.forEach((label, i) => {
      const x = canvas.width * freqPositions[i];
      ctx.fillText(label, x, canvas.height - 5);
    });
    
    // Add dB labels
    ctx.textAlign = 'left';
    ctx.fillText('+15dB', 5, 15);
    ctx.fillText('0dB', 5, canvas.height / 2 - 5);
    ctx.fillText('-15dB', 5, canvas.height - 15);
    
    // Draw interpolated EQ curves
    if (isSplitEarMode) {
      // Draw left ear curve (blue)
      const leftInterpolatedGains = interpolatePresets(
        transitionPresets.fromLeft, 
        transitionPresets.toLeft, 
        progress
      );
      drawEQCurveWithValues(leftInterpolatedGains, '#3b82f6', ctx, canvas.width, canvas.height, zeroDbY);
      
      // Draw right ear curve (red)
      const rightInterpolatedGains = interpolatePresets(
        transitionPresets.fromRight, 
        transitionPresets.toRight, 
        progress
      );
      drawEQCurveWithValues(rightInterpolatedGains, '#ef4444', ctx, canvas.width, canvas.height, zeroDbY);
      
      // Add a legend
      ctx.font = '12px system-ui';
      ctx.fillStyle = '#3b82f6';
      ctx.fillText('Left', canvas.width - 60, 20);
      ctx.fillStyle = '#ef4444';
      ctx.fillText('Right', canvas.width - 60, 40);
    } else {
      // Draw unified curve (orange)
      const unifiedInterpolatedGains = interpolatePresets(
        transitionPresets.fromUnified, 
        transitionPresets.toUnified, 
        progress
      );
      drawEQCurveWithValues(unifiedInterpolatedGains, '#dd6b20', ctx, canvas.width, canvas.height, zeroDbY);
    }
  };
  
  // Helper function to draw EQ curve with specific gain values
  const drawEQCurveWithValues = (
    gainValues: number[], 
    color: string, 
    ctx: CanvasRenderingContext2D, 
    canvasWidth: number, 
    canvasHeight: number, 
    zeroDbY: number
  ) => {
    // Set up curve style
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    
    // If EQ is disabled, reduce opacity
    if (!isEQEnabled) {
      ctx.globalAlpha = 0.4; // 40% opacity when disabled
    } else {
      ctx.globalAlpha = 1.0; // Full opacity when enabled
    }
    
    // Draw curve
    ctx.beginPath();
    
    // Start at left edge (lowest frequency)
    ctx.moveTo(0, zeroDbY - (gainValues[0] / 15) * (canvasHeight / 2) * 0.7);
    
    // Calculate control points for smooth curve
    const points = [];
    
    // Add first frequency point
    const x1 = canvasWidth * 0.25; // Low frequency (100Hz)
    const y1 = zeroDbY - (gainValues[0] / 15) * (canvasHeight / 2) * 0.7;
    points.push({x: x1, y: y1});
    
    // Add mid frequency point
    const x2 = canvasWidth * 0.5; // Mid frequency (1kHz)
    const y2 = zeroDbY - (gainValues[1] / 15) * (canvasHeight / 2) * 0.7;
    points.push({x: x2, y: y2});
    
    // Add high frequency point
    const x3 = canvasWidth * 0.75; // High frequency (5kHz)
    const y3 = zeroDbY - (gainValues[2] / 15) * (canvasHeight / 2) * 0.7;
    points.push({x: x3, y: y3});
    
    // Draw a smooth curve through the points
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      
      if (i === 0) {
        // Draw line from start to first point
        ctx.lineTo(point.x, point.y);
      } else {
        // Draw quadratic curve between points
        const prevPoint = points[i-1];
        const cpX = (prevPoint.x + point.x) / 2;
        ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, (prevPoint.y + point.y) / 2);
        ctx.lineTo(point.x, point.y);
      }
    }
    
    // Continue to right edge
    ctx.lineTo(canvasWidth, zeroDbY - (gainValues[2] / 15) * (canvasHeight / 2) * 0.7);
    
    // Stroke the path
    ctx.stroke();
    
    // Add dots at each frequency point
    ctx.fillStyle = color;
    points.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // Reset opacity for next drawing
    ctx.globalAlpha = 1.0;
  };

  // Handle seeking
  const handleSeek = (value: number[]) => {
    if (audioRef.current && duration > 0) {
      const newTime = (value[0] / 100) * duration;
      audioRef.current.currentTime = newTime;
      setProgress(value[0]);
    }
  };

  // Initialize audio context - only call this when user interacts
  const initializeAudioContext = async () => {
    try {
      console.log("Initializing audio context...");
      
      // Close any existing context
      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        } catch (e) {
          console.error("Error closing previous context:", e);
        }
      }
      
      // Clear node references
      sourceRef.current = null;
      filtersRef.current = [];
      leftFiltersRef.current = [];
      rightFiltersRef.current = [];
      splitterRef.current = null;
      mergerRef.current = null;
      leftGainRef.current = null;
      rightGainRef.current = null;
      
      // Create a new audio context
      if (!audioRef.current) {
        console.error("No audio element available");
        return false;
      }
      
      // Create audio context
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      console.log("Audio context created, state:", ctx.state);
      
      // Resume the context (needed for some browsers)
      if (ctx.state === 'suspended') {
        await ctx.resume();
        console.log("Audio context resumed, new state:", ctx.state);
      }
      
      audioContextRef.current = ctx;
      
      // Create source node
      sourceRef.current = ctx.createMediaElementSource(audioRef.current);
      console.log("Media element source created");
      
      // Basic setup - just connect source to destination initially
      sourceRef.current.connect(ctx.destination);
      
      setAudioInitialized(true);
      console.log("Audio context initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize audio context:", error);
      return false;
    }
  };

  // Reconfigure audio routing based on all current settings
  const updateAudioRouting = async () => {
    try {
      // Skip if we don't have a context or source yet
      if (!audioContextRef.current || !sourceRef.current) {
        console.log("Cannot update audio routing - missing context or source");
        return false;
      }
      
      const context = audioContextRef.current;
      const mediaSource = sourceRef.current;
      
      // First disconnect everything
      try {
        mediaSource.disconnect();
      } catch (e) {
        console.warn("Error disconnecting source:", e);
      }
      
      console.log("Updating audio routing, mode:", isSplitEarMode ? "split" : "unified", "EQ enabled:", isEQEnabled);
      
      // Define frequency bands
      const freqs = [100, 1000, 5000];
      
      if (isSplitEarMode) {
        // SPLIT EAR MODE SETUP
        console.log("Setting up split ear mode");
        
        // Create splitter
        const splitter = context.createChannelSplitter(2);
        splitterRef.current = splitter;
        
        // Create merger
        const merger = context.createChannelMerger(2);
        mergerRef.current = merger;
        
        // Create gain nodes
        const leftGain = context.createGain();
        const rightGain = context.createGain();
        leftGainRef.current = leftGain;
        rightGainRef.current = rightGain;
        
        // Create left filters
        const leftFilters = freqs.map(freq => {
          const filter = context.createBiquadFilter();
          filter.type = "peaking";
          filter.frequency.value = freq;
          filter.gain.value = 0;
          filter.Q.value = 1.0;
          return filter;
        });
        leftFiltersRef.current = leftFilters;
        
        // Create right filters
        const rightFilters = freqs.map(freq => {
          const filter = context.createBiquadFilter();
          filter.type = "peaking";
          filter.frequency.value = freq;
          filter.gain.value = 0;
          filter.Q.value = 1.0;
          return filter;
        });
        rightFiltersRef.current = rightFilters;
        
        // Apply balance
        leftGain.gain.value = balance <= 0.5 ? 1 : 1 - (balance - 0.5) * 2;
        rightGain.gain.value = balance >= 0.5 ? 1 : balance * 2;
        
        // Connect everything in sequence
        mediaSource.connect(splitter);
        
        // Left channel
        splitter.connect(leftFilters[0], 0);
        leftFilters[0].connect(leftFilters[1]);
        leftFilters[1].connect(leftFilters[2]);
        leftFilters[2].connect(leftGain);
        leftGain.connect(merger, 0, 0);
        
        // Right channel
        splitter.connect(rightFilters[0], 1);
        rightFilters[0].connect(rightFilters[1]);
        rightFilters[1].connect(rightFilters[2]);
        rightFilters[2].connect(rightGain);
        rightGain.connect(merger, 0, 1);
        
        // Connect merger to destination
        merger.connect(context.destination);
        
        // Apply presets to left and right if EQ is enabled
        if (isEQEnabled) {
          applyEQPreset(leftEarPreset, leftFilters);
          applyEQPreset(rightEarPreset, rightFilters);
        }
        
        console.log("Split ear mode setup complete");
      } else {
        // UNIFIED MODE SETUP
        console.log("Setting up unified mode");
        
        // Create filters
        const filters = freqs.map(freq => {
          const filter = context.createBiquadFilter();
          filter.type = "peaking";
          filter.frequency.value = freq;
          filter.gain.value = 0;
          filter.Q.value = 1.0;
          return filter;
        });
        filtersRef.current = filters;
        
        // Create splitter for balance control
        const splitter = context.createChannelSplitter(2);
        splitterRef.current = splitter;
        
        // Create merger
        const merger = context.createChannelMerger(2);
        mergerRef.current = merger;
        
        // Create gain nodes for balance
        const leftGain = context.createGain();
        const rightGain = context.createGain();
        leftGainRef.current = leftGain;
        rightGainRef.current = rightGain;
        
        // Apply balance
        leftGain.gain.value = balance <= 0.5 ? 1 : 1 - (balance - 0.5) * 2;
        rightGain.gain.value = balance >= 0.5 ? 1 : balance * 2;
        
        // Connect nodes: Source -> Filters -> Splitter -> Gains -> Merger -> Destination
        mediaSource.connect(filters[0]);
        filters[0].connect(filters[1]);
        filters[1].connect(filters[2]);
        
        // Split for balance control
        filters[2].connect(splitter);
        splitter.connect(leftGain, 0);
        splitter.connect(rightGain, 1);
        leftGain.connect(merger, 0, 0);
        rightGain.connect(merger, 0, 1);
        merger.connect(context.destination);
        
        // Apply unified preset if EQ is enabled
        if (isEQEnabled) {
          applyEQPreset(unifiedPreset, filters);
        }
        
        console.log("Unified mode setup complete");
      }
      
      // Update the visualization
      requestAnimationFrame(() => updateFrequencyResponse());
      
      return true;
    } catch (error) {
      console.error("Error in updateAudioRouting:", error);
      return false;
    }
  };

  // Apply EQ preset to a set of filters
  const applyEQPreset = (preset: PresetType, filters: BiquadFilterNode[]) => {
    if (!audioContextRef.current || filters.length === 0) return;
    
    console.log(`Applying preset ${preset} to filters`, isEQEnabled ? "EQ is ON" : "EQ is OFF");
    
    const values = presetValues[preset];
    
    // Apply values immediately
    filters.forEach((filter, index) => {
      if (filter && typeof filter.gain !== 'undefined' && index < values.length) {
        // When EQ is disabled, set actual filter gain to 0 (no effect)
        filter.gain.value = isEQEnabled ? values[index] : 0;
        console.log(`Filter ${index} gain set to:`, filter.gain.value);
      }
    });
  };

  // Calculate and update the frequency response curve
  // Allow overriding the current EQ state and presets for immediate updates
  const updateFrequencyResponse = (eqEnabledOverride?: boolean, 
                                 forcePresets?: {
                                   unified?: PresetType, 
                                   left?: PresetType, 
                                   right?: PresetType
                                 }) => {
    // If we're in the middle of a transition animation, don't disrupt it
    if (transitionTimerRef.current !== null) {
      return;
    }

    if (!canvasRef.current) {
      console.log("Cannot update visualization - canvas not available");
      return;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Use overrides if provided, otherwise use current state
    const effectiveEQEnabled = eqEnabledOverride !== undefined ? eqEnabledOverride : isEQEnabled;
    const effectiveUnifiedPreset = forcePresets?.unified || unifiedPreset;
    const effectiveLeftPreset = forcePresets?.left || leftEarPreset;
    const effectiveRightPreset = forcePresets?.right || rightEarPreset;
    
    console.log("Updating frequency response visualization", 
      isSplitEarMode ? "Split mode" : "Unified mode", 
      "Presets:", isSplitEarMode ? 
        `Left: ${effectiveLeftPreset}, Right: ${effectiveRightPreset}` : 
        `Unified: ${effectiveUnifiedPreset}`,
      "EQ enabled:", effectiveEQEnabled ? "yes" : "no");
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw 3D effect grid
    const gridColor = '#e9ecef';
    const gridLines = 12;
    const gridSpacingH = canvas.width / gridLines;
    const gridSpacingV = canvas.height / gridLines;
    
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= gridLines; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * gridSpacingV);
      ctx.lineTo(canvas.width, i * gridSpacingV);
      ctx.stroke();
    }
    
    // Vertical grid lines
    for (let i = 0; i <= gridLines; i++) {
      ctx.beginPath();
      ctx.moveTo(i * gridSpacingH, 0);
      ctx.lineTo(i * gridSpacingH, canvas.height);
      ctx.stroke();
    }
    
    // Draw zero line with a different color
    ctx.strokeStyle = '#ced4da';
    ctx.lineWidth = 2;
    const zeroDbY = canvas.height / 2;
    ctx.beginPath();
    ctx.moveTo(0, zeroDbY);
    ctx.lineTo(canvas.width, zeroDbY);
    ctx.stroke();
    
    // Add frequency labels
    ctx.fillStyle = '#6c757d';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    
    const freqLabels = ['20Hz', '100Hz', '1kHz', '5kHz', '20kHz'];
    const freqPositions = [0.05, 0.25, 0.5, 0.75, 0.95];
    
    freqLabels.forEach((label, i) => {
      const x = canvas.width * freqPositions[i];
      ctx.fillText(label, x, canvas.height - 5);
    });
    
    // Add dB labels
    ctx.textAlign = 'left';
    ctx.fillText('+15dB', 5, 15);
    ctx.fillText('0dB', 5, canvas.height / 2 - 5);
    ctx.fillText('-15dB', 5, canvas.height - 15);
    
    // Draw EQ curve(s)
    const drawEQCurve = (activePreset: PresetType, color: string) => {
      // Get preset values for visualization
      const presetGains = presetValues[activePreset];
      
      // Set up curve style
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      
      // If EQ is disabled, reduce opacity
      if (!effectiveEQEnabled) {
        ctx.globalAlpha = 0.4; // 40% opacity when disabled
      } else {
        ctx.globalAlpha = 1.0; // Full opacity when enabled
      }
      
      // Draw curve
      ctx.beginPath();
      
      // Start at left edge (lowest frequency)
      ctx.moveTo(0, zeroDbY - (presetGains[0] / 15) * (canvas.height / 2) * 0.7);
      
      // Calculate control points for smooth curve
      const points = [];
      
      // Add first frequency point
      const x1 = canvas.width * 0.25; // Low frequency (100Hz)
      const y1 = zeroDbY - (presetGains[0] / 15) * (canvas.height / 2) * 0.7;
      points.push({x: x1, y: y1});
      
      // Add mid frequency point
      const x2 = canvas.width * 0.5; // Mid frequency (1kHz)
      const y2 = zeroDbY - (presetGains[1] / 15) * (canvas.height / 2) * 0.7;
      points.push({x: x2, y: y2});
      
      // Add high frequency point
      const x3 = canvas.width * 0.75; // High frequency (5kHz)
      const y3 = zeroDbY - (presetGains[2] / 15) * (canvas.height / 2) * 0.7;
      points.push({x: x3, y: y3});
      
      // Draw a smooth curve through the points
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        if (i === 0) {
          // Draw line from start to first point
          ctx.lineTo(point.x, point.y);
        } else {
          // Draw quadratic curve between points
          const prevPoint = points[i-1];
          const cpX = (prevPoint.x + point.x) / 2;
          ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, (prevPoint.y + point.y) / 2);
          ctx.lineTo(point.x, point.y);
        }
      }
      
      // Continue to right edge
      ctx.lineTo(canvas.width, zeroDbY - (presetGains[2] / 15) * (canvas.height / 2) * 0.7);
      
      // Stroke the path
      ctx.stroke();
      
      // Add dots at each frequency point
      ctx.fillStyle = color;
      points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Reset opacity for next drawing
      ctx.globalAlpha = 1.0;
    };
    
    // Draw curves based on current mode
    if (isSplitEarMode) {
      // Use red and blue for split mode
      // Draw curves based on effective presets (which may be overridden)
      drawEQCurve(effectiveLeftPreset, '#3b82f6'); // Blue for left
      drawEQCurve(effectiveRightPreset, '#ef4444'); // Red for right
      
      // Add a legend
      ctx.font = '12px system-ui';
      ctx.fillStyle = '#3b82f6';
      ctx.fillText('Left', canvas.width - 60, 20);
      ctx.fillStyle = '#ef4444';
      ctx.fillText('Right', canvas.width - 60, 40);
    } else {
      // Use dark orange for unified mode
      // Draw curve based on effective preset (which may be overridden)
      drawEQCurve(effectiveUnifiedPreset, '#dd6b20'); // Dark orange for unified
    }
    
    // Store the animation frame ID for possible cancellation
    animationFrameRef.current = null;
  };

  // Toggle play/pause - fixed version with proper initialization
  const togglePlayPause = async () => {
    try {
      if (!audioRef.current) {
        console.error("No audio element available");
        return;
      }
      
      console.log("Toggle play/pause, current state:", isPlaying ? "playing" : "paused");
      
      if (isPlaying) {
        // Pause playback
        audioRef.current.pause();
        setIsPlaying(false);
        console.log("Audio paused");
      } else {
        // Initialize audio context if needed (only on first play)
        if (!audioInitialized) {
          console.log("First play - initializing audio context");
          const success = await initializeAudioContext();
          if (!success) {
            console.error("Failed to initialize audio");
            alert("Failed to initialize audio. Please try again or use a different browser.");
            return;
          }
          
          // Now that we have an audio context, set up audio routing
          await updateAudioRouting();
        } else if (audioContextRef.current?.state === 'suspended') {
          // Resume audio context if suspended
          console.log("Audio context suspended, resuming...");
          await audioContextRef.current.resume();
        }
        
        // Ensure audio is loaded
        if (!isAudioLoaded) {
          console.log("Audio not loaded, waiting...");
          try {
            audioRef.current.load();
            await new Promise<void>((resolve, reject) => {
              const loadTimeout = setTimeout(() => {
                reject(new Error("Audio loading timed out"));
              }, 5000);
              
              audioRef.current!.oncanplaythrough = () => {
                clearTimeout(loadTimeout);
                setIsAudioLoaded(true);
                resolve();
              };
              
              audioRef.current!.onerror = () => {
                clearTimeout(loadTimeout);
                reject(new Error("Audio loading failed"));
              };
            });
          } catch (error) {
            console.error("Failed to load audio:", error);
            alert("Failed to load audio: " + (error as Error).message);
            return;
          }
        }
        
        // Play audio
        try {
          console.log("Starting playback...");
          const playPromise = audioRef.current.play();
          await playPromise;
          setIsPlaying(true);
          console.log("✅ Playback started successfully");
        } catch (error) {
          console.error("❌ Playback error:", error);
          
          // Handle autoplay policy error
          if (error instanceof Error && error.name === 'NotAllowedError') {
            alert("Autoplay blocked by browser. Please try clicking play again.");
          } else {
            alert("Playback error: " + error);
          }
        }
      }
    } catch (error) {
      console.error("Error in togglePlayPause:", error);
    }
  };

  // Toggle between unified and split ear modes with smooth transition
  const toggleEarMode = () => {
    // Get current values
    const newSplitMode = !isSplitEarMode;
    console.log(`Switching to ${newSplitMode ? 'split' : 'unified'} mode`);
    
    try {
      // IMPORTANT: Disconnect everything before state changes
      if (audioContextRef.current && sourceRef.current) {
        console.log("Disconnecting audio for mode switch");
        sourceRef.current.disconnect();
      }
    } catch (e) {
      console.warn("Error disconnecting source:", e);
    }
    
    // First time split mode initialization
    if (newSplitMode && !splitModeInitialized) {
      console.log("First time in split mode, initializing with flat presets");
      setSplitModeInitialized(true);
      setLeftEarPreset("flat");
      setRightEarPreset("flat");
    }
    
    // Cancel any ongoing transition
    if (transitionTimerRef.current !== null) {
      clearInterval(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    
    // If switching to split mode, start a transition from unified to split (left and right)
    // If switching to unified mode, start a transition from split (left and right) to unified
    if (newSplitMode) {
      // Start a transition from unified to both left and right being the same as unified
      startPresetTransition(unifiedPreset, unifiedPreset, unifiedPreset, "flat", unifiedPreset, "flat");
    } else {
      // Start a transition from left and right to a unified preset (use left for now)
      startPresetTransition(leftEarPreset, "flat", leftEarPreset, "flat", rightEarPreset, "flat");
    }
    
    // Update the mode state
    setIsSplitEarMode(newSplitMode);
    
    // Immediate audio graph rebuild will be handled by the useEffect that watches isSplitEarMode
  };

  // Toggle EQ on/off with smooth transition for visualization
  const toggleEQ = () => {
    // Get the next value before updating state
    const newValue = !isEQEnabled;
    
    // Apply audio node changes synchronously
    if (audioInitialized) {
      // Apply EQ changes to audio nodes immediately
      if (isSplitEarMode) {
        if (leftFiltersRef.current.length > 0) {
          const leftValues = presetValues[leftEarPreset];
          leftFiltersRef.current.forEach((filter, index) => {
            if (filter && index < leftValues.length) {
              filter.gain.value = newValue ? leftValues[index] : 0;
            }
          });
        }
        
        if (rightFiltersRef.current.length > 0) {
          const rightValues = presetValues[rightEarPreset];
          rightFiltersRef.current.forEach((filter, index) => {
            if (filter && index < rightValues.length) {
              filter.gain.value = newValue ? rightValues[index] : 0;
            }
          });
        }
      } else {
        if (filtersRef.current.length > 0) {
          const values = presetValues[unifiedPreset];
          filtersRef.current.forEach((filter, index) => {
            if (filter && index < values.length) {
              filter.gain.value = newValue ? values[index] : 0;
            }
          });
        }
      }
    }
    
    // Now update state
    setIsEQEnabled(newValue);
    
    // Schedule a visualization update with the new EQ state
    // No need for a transition animation here since it's just an opacity change
    updateFrequencyResponse(newValue);
  };

  // Reset EQ to flat with smooth transition
  const resetEQ = () => {
    console.log("Resetting EQ to flat");
    
    if (isSplitEarMode) {
      // Skip if already flat
      if (leftEarPreset === "flat" && rightEarPreset === "flat") return;
      
      // Immediately apply flat EQ to both channels
      if (audioInitialized) {
        const flatValues = presetValues["flat"];
        
        if (leftFiltersRef.current.length > 0) {
          leftFiltersRef.current.forEach((filter, index) => {
            if (filter && index < flatValues.length) {
              filter.gain.value = isEQEnabled ? flatValues[index] : 0;
              console.log(`Left filter ${index} reset to:`, filter.gain.value);
            }
          });
        }
        
        if (rightFiltersRef.current.length > 0) {
          rightFiltersRef.current.forEach((filter, index) => {
            if (filter && index < flatValues.length) {
              filter.gain.value = isEQEnabled ? flatValues[index] : 0;
              console.log(`Right filter ${index} reset to:`, filter.gain.value);
            }
          });
        }
      }
      
      // Start a smooth transition to flat for both channels
      startPresetTransition(
        unifiedPreset, unifiedPreset,
        leftEarPreset, "flat",
        rightEarPreset, "flat"
      );
      
      // Now update state
      setLeftEarPreset("flat");
      setRightEarPreset("flat");
    } else {
      // Skip if already flat
      if (unifiedPreset === "flat") return;
      
      // Immediately apply flat EQ to unified channel
      if (audioInitialized && filtersRef.current.length > 0) {
        const flatValues = presetValues["flat"];
        filtersRef.current.forEach((filter, index) => {
          if (filter && index < flatValues.length) {
            filter.gain.value = isEQEnabled ? flatValues[index] : 0;
            console.log(`Unified filter ${index} reset to:`, filter.gain.value);
          }
        });
      }
      
      // Start a smooth transition to flat
      startPresetTransition(unifiedPreset, "flat", leftEarPreset, "flat", rightEarPreset, "flat");
      
      // Now update state
      setUnifiedPreset("flat");
    }
  };

  // Update balance with visual update but no animation needed
  const updateBalance = (newBalance: number[]) => {
    const balanceValue = newBalance[0];
    
    // Apply balance changes immediately to audio nodes
    if (audioInitialized) {
      if (leftGainRef.current && rightGainRef.current) {
        leftGainRef.current.gain.value = balanceValue <= 0.5 ? 1 : 1 - (balanceValue - 0.5) * 2;
        rightGainRef.current.gain.value = balanceValue >= 0.5 ? 1 : balanceValue * 2;
      }
    }
    
    // Force immediate visualization update - this helps overcome the frame lag
    updateFrequencyResponse();
    
    // Now update state
    setBalance(balanceValue);
  };

  // Apply preset to unified mode with smooth transition
  const applyUnifiedPreset = (preset: PresetType) => {
    if (preset === unifiedPreset) return; // No change
    
    console.log("Setting unified preset to:", preset);
    
    // First, immediately apply to filters if in unified mode and audio is initialized
    if (!isSplitEarMode && audioInitialized && filtersRef.current.length > 0) {
      console.log("Immediately applying unified preset");
      const values = presetValues[preset];
      filtersRef.current.forEach((filter, index) => {
        if (filter && index < values.length) {
          filter.gain.value = isEQEnabled ? values[index] : 0;
          console.log(`Unified filter ${index} gain set to:`, filter.gain.value);
        }
      });
    }
    
    // Start a smooth transition for visualization
    startPresetTransition(unifiedPreset, preset, leftEarPreset, leftEarPreset, rightEarPreset, rightEarPreset);
    
    // Update state
    setUnifiedPreset(preset);
  };

  // Apply preset to left ear only with smooth transition
  const applyLeftEarPreset = (preset: PresetType) => {
    if (preset === leftEarPreset) return; // No change
    
    console.log("Setting left ear preset to:", preset);
    
    // First, immediately apply to filters if in split mode and audio is initialized
    if (isSplitEarMode && audioInitialized && leftFiltersRef.current.length > 0) {
      console.log("Immediately applying left ear preset");
      const values = presetValues[preset];
      leftFiltersRef.current.forEach((filter, index) => {
        if (filter && index < values.length) {
          filter.gain.value = isEQEnabled ? values[index] : 0;
          console.log(`Left filter ${index} gain set to:`, filter.gain.value);
        }
      });
    }
    
    // Start a smooth transition for visualization
    startPresetTransition(unifiedPreset, unifiedPreset, leftEarPreset, preset, rightEarPreset, rightEarPreset);
    
    // Update state
    setLeftEarPreset(preset);
  };

  // Apply preset to right ear only with smooth transition
  const applyRightEarPreset = (preset: PresetType) => {
    if (preset === rightEarPreset) return; // No change
    
    console.log("Setting right ear preset to:", preset);
    
    // First, immediately apply to filters if in split mode and audio is initialized
    if (isSplitEarMode && audioInitialized && rightFiltersRef.current.length > 0) {
      console.log("Immediately applying right ear preset");
      const values = presetValues[preset];
      rightFiltersRef.current.forEach((filter, index) => {
        if (filter && index < values.length) {
          filter.gain.value = isEQEnabled ? values[index] : 0;
          console.log(`Right filter ${index} gain set to:`, filter.gain.value);
        }
      });
    }
    
    // Start a smooth transition for visualization
    startPresetTransition(unifiedPreset, unifiedPreset, leftEarPreset, leftEarPreset, rightEarPreset, preset);
    
    // Update state
    setRightEarPreset(preset);
  };

  // Clean up animations and timers when component unmounts
  useEffect(() => {
    return () => {
      // Cancel any ongoing transition
      if (transitionTimerRef.current !== null) {
        clearInterval(transitionTimerRef.current);
      }
      
      // Cancel any pending animation frame
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  // Initialize the canvas when component mounts - this ensures we have a proper initial render
  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        
        // Force immediate initial draw
        updateFrequencyResponse();
        
        // Then schedule multiple redraws to ensure visualization is correct
        // This helps eliminate the "one frame behind" issue by forcing multiple renders
        const initialRenderTimeouts = [];
        
        // Schedule multiple redraws at different intervals
        [0, 16, 50, 100, 500].forEach(delay => {
          const timeout = setTimeout(() => {
            requestAnimationFrame(() => {
              updateFrequencyResponse();
            });
          }, delay);
          initialRenderTimeouts.push(timeout);
        });
        
        return () => {
          // Clean up all timeouts
          initialRenderTimeouts.forEach(timeout => clearTimeout(timeout));
        };
      }
    }
  }, []);

  const PresetButton = ({ 
    preset, 
    activePreset, 
    onClick 
  }: { 
    preset: PresetType, 
    activePreset: PresetType, 
    onClick: () => void 
  }) => {
    // Map presets to colors
    const colorMap = {
      flat: {
        active: { bg: "#374151", text: "white" },
        inactive: { bg: "#F3F4F6", text: "#1F2937" }
      },
      bassBoost: {
        active: { bg: "#1D4ED8", text: "white" },
        inactive: { bg: "#DBEAFE", text: "#1E40AF" }
      },
      vocalEnhancer: {
        active: { bg: "#047857", text: "white" },
        inactive: { bg: "#D1FAE5", text: "#065F46" }
      },
      trebleBoost: {
        active: { bg: "#7E22CE", text: "white" },
        inactive: { bg: "#F3E8FF", text: "#6B21A8" }
      }
    };
    
    const isActive = activePreset === preset;
    const style = colorMap[preset];
    
    return (
      <button 
        className={`text-sm font-medium rounded-md shadow-sm transition-colors ${!isEQEnabled ? "opacity-60" : ""}`}
        style={{
          backgroundColor: isActive ? style.active.bg : style.inactive.bg,
          color: isActive ? style.active.text : style.inactive.text,
          padding: "8px 12px",
          border: "none",
        }}
        onClick={onClick}
        disabled={!isEQEnabled}
      >
        {preset === 'flat' ? 'Flat' : 
         preset === 'bassBoost' ? 'Bass Boost' :
         preset === 'vocalEnhancer' ? 'Vocal Enhancer' : 'Treble Boost'}
      </button>
    );
  };

  const renderUnifiedControls = () => (
    <div className="flex flex-wrap gap-2 justify-center">
      <PresetButton 
        preset="flat" 
        activePreset={unifiedPreset} 
        onClick={() => applyUnifiedPreset("flat")} 
      />
      <PresetButton 
        preset="bassBoost" 
        activePreset={unifiedPreset} 
        onClick={() => applyUnifiedPreset("bassBoost")} 
      />
      <PresetButton 
        preset="vocalEnhancer" 
        activePreset={unifiedPreset} 
        onClick={() => applyUnifiedPreset("vocalEnhancer")} 
      />
      <PresetButton 
        preset="trebleBoost" 
        activePreset={unifiedPreset} 
        onClick={() => applyUnifiedPreset("trebleBoost")} 
      />
    </div>
  );
  
  return (
    <Card className="w-[400px] overflow-hidden bg-white rounded-xl shadow-lg">
      <audio ref={audioRef} />
      <CardHeader className="p-0 relative bg-gradient-to-b from-neutral-800 to-black h-56 flex flex-col justify-end">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
        
        {/* Album cover */}
        <div className="absolute top-4 left-4 w-36 h-36 rounded-md overflow-hidden shadow-lg">
          <img 
            src={playerData.song.cover} 
            alt="Album cover" 
            className="w-full h-full object-cover" 
          />
        </div>
        
        {/* Track info */}
        <div className="relative p-4 text-white">
          <h2 className="text-lg font-bold">{playerData.song.name}</h2>
          <p className="text-sm text-white/80">{playerData.song.author}</p>
        </div>
      </CardHeader>
      
      <CardContent className="p-4">
        <div className="space-y-4">
          {/* Playback controls */}
          <div className="flex items-center justify-between">
            <div className="w-10" /> {/* Spacer */}
            
            <button 
              className="w-12 h-12 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors"
              onClick={togglePlayPause}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} fill="white" />}
            </button>
            
            <div className="flex items-center space-x-2">
              <Volume2 size={18} className="text-gray-500" />
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="space-y-1">
            <Slider
              value={[progress]}
              min={0}
              max={100}
              step={0.01}
              onValueChange={handleSeek}
              className="cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
              <span>{new Date(duration * 1000).toISOString().substr(14, 5)}</span>
            </div>
          </div>
          
          <div className="border-t border-gray-100 pt-4">
            <Tabs defaultValue="eq">
              <TabsList className="grid grid-cols-2 mb-4">
                <TabsTrigger value="eq" className="text-xs">Equalizer</TabsTrigger>
                <TabsTrigger value="settings" className="text-xs">Settings</TabsTrigger>
              </TabsList>
              
              <TabsContent value="eq" className="space-y-4">
                {/* EQ visualization */}
                <div className="border border-gray-200 rounded-md p-2 h-32 relative">
                  <canvas ref={canvasRef} className="w-full h-full" />
                </div>
                
                {/* EQ toggle and mode selector */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <Switch 
                      checked={isEQEnabled} 
                      onCheckedChange={toggleEQ} 
                      id="eq-toggle"
                    />
                    <label htmlFor="eq-toggle" className="text-sm font-medium">
                      EQ {isEQEnabled ? "On" : "Off"}
                    </label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={toggleEarMode}
                      className="text-xs h-8"
                    >
                      {isSplitEarMode ? "Unified Mode" : "Split Ear Mode"}
                    </Button>
                  </div>
                </div>
                
                {/* EQ presets */}
                <div className="space-y-3">
                  {isSplitEarMode ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium mb-2 text-blue-600">Left Ear</p>
                        <div className="flex flex-wrap gap-2">
                          <PresetButton 
                            preset="flat" 
                            activePreset={leftEarPreset}
                            onClick={() => applyLeftEarPreset("flat")}
                          />
                          <PresetButton 
                            preset="bassBoost" 
                            activePreset={leftEarPreset}
                            onClick={() => applyLeftEarPreset("bassBoost")}
                          />
                          <PresetButton 
                            preset="vocalEnhancer" 
                            activePreset={leftEarPreset}
                            onClick={() => applyLeftEarPreset("vocalEnhancer")}
                          />
                          <PresetButton 
                            preset="trebleBoost" 
                            activePreset={leftEarPreset}
                            onClick={() => applyLeftEarPreset("trebleBoost")}
                          />
                        </div>
                      </div>
                      
                      <div>
                        <p className="text-sm font-medium mb-2 text-red-600">Right Ear</p>
                        <div className="flex flex-wrap gap-2">
                          <PresetButton 
                            preset="flat" 
                            activePreset={rightEarPreset}
                            onClick={() => applyRightEarPreset("flat")}
                          />
                          <PresetButton 
                            preset="bassBoost" 
                            activePreset={rightEarPreset}
                            onClick={() => applyRightEarPreset("bassBoost")}
                          />
                          <PresetButton 
                            preset="vocalEnhancer" 
                            activePreset={rightEarPreset}
                            onClick={() => applyRightEarPreset("vocalEnhancer")}
                          />
                          <PresetButton 
                            preset="trebleBoost" 
                            activePreset={rightEarPreset}
                            onClick={() => applyRightEarPreset("trebleBoost")}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium mb-2">Presets</p>
                      {renderUnifiedControls()}
                    </div>
                  )}
                </div>
                
                {/* Balance control */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Balance</span>
                    <Button onClick={resetEQ} size="sm" variant="outline" className="h-7 text-xs">
                      Reset EQ
                    </Button>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs">L</span>
                    <Slider 
                      value={[balance]} 
                      min={0} 
                      max={1} 
                      step={0.01} 
                      onValueChange={updateBalance}
                    />
                    <span className="text-xs">R</span>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="settings" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">(Todo) Channel Mode</h3>
                    <ToggleGroup 
                      type="single" 
                      value={channelMode}
                      onValueChange={(value) => {
                        if (value) setChannelMode(value as ChannelMode);
                      }}
                      className="justify-start"
                    >
                      <ToggleGroupItem value="stereo" size="sm" className="text-xs">
                        Stereo
                      </ToggleGroupItem>
                      <ToggleGroupItem value="mono" size="sm" className="text-xs">
                        Mono
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">(Todo) Solo Mode</h3>
                    <ToggleGroup 
                      type="single" 
                      value={soloMode}
                      onValueChange={(value) => {
                        if (value) setSoloMode(value as SoloMode);
                      }}
                      className="justify-start"
                    >
                      <ToggleGroupItem value="none" size="sm" className="text-xs">
                        Off
                      </ToggleGroupItem>
                      <ToggleGroupItem value="left" size="sm" className="text-xs">
                        Left
                      </ToggleGroupItem>
                      <ToggleGroupItem value="right" size="sm" className="text-xs">
                        Right
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}