function PhaseVocoder(winSize, sampleRate) {

	var _sampleRate = sampleRate; var _RS = 0; var _RA = 0; var _omega;

	var _previousInputPhase; var _previousOutputPhase; var _framingWindow;
	
	var _squaredFramingWindow; var _winSize = winSize;

	var _overlapBuffers; var _owOverlapBuffers;

	var _first = true;

	var _overlapFactor = 4;

	var _lastInputAlpha = 1;

	var stdlib = {
	    Math: Math,
	    Float32Array: Float32Array,
	    Float64Array: Float64Array
	};

	var dromHeap = new ArrayBuffer(32*_winSize);
	var dromFFT = fourier.custom["fft_f32_"+_winSize+"_asm"](stdlib, null, dromHeap);
	dromFFT.init();

	var sqrt = Math.sqrt; var cos = Math.cos;
	var sin = Math.sin; var atan2 = Math.atan2;


	//--------------------------------------------------
	//------------PRE-ALLOCATED MEMORY------------------
	//--------------------------------------------------

	//find_peaks
	var _hlfSize = Math.round(_winSize/2)+1;

	// // process
	var _process = {
		fftObj : {
			real: new Float32Array(_hlfSize), 
			imag: new Float32Array(_hlfSize), 
			magnitude: new Float32Array(_hlfSize), 
			phase: new Float32Array(_hlfSize)
		}, 
		pvOut : {
			real: create_constant_array(_winSize, 0, Float32Array), 
			imag: create_constant_array(_winSize, 0, Float32Array), 
			magnitude: create_constant_array(_winSize, 0, Float32Array), 
			phase: create_constant_array(_winSize, 0, Float32Array)
		},
		processedFrame : new Float32Array(_winSize)
	};

	var _pv_step = {
		instPhaseAdv : new Float32Array(_hlfSize), 
		phTh : new Float32Array(_hlfSize)
	};

	var _STFT = {
		_inputFrame : new Float32Array(_winSize),
		_zeros: new Float32Array(_winSize)
	}
	//--------------------------------------------------
	//--------------------------------------------------
	//--------------------------------------------------

	var phTh_idx = 0;
	var twoPI = 2 * Math.PI;
	var expectedPhaseAdv, auxHeterodynedPhaseIncr, heterodynedPhaseIncr, instPhaseAdvPerSampleHop, instPhaseAdv_, prevInstPhaseAdv_;
	
	function overlap_and_slide(RS, inF, squaredWinF, oBuf, owOBuf, windowSize, outF) {

		var i = 0;
		var owSample = 0;

		for (var i = 0; i < RS; i++) {
			owSample = owOBuf.shift();
			outF[i] = oBuf.shift() / ((owSample<10e-3)? 1 : owSample);
			oBuf[oBuf.length] = owOBuf[owOBuf.length] = 0;
		}

		for (var i = 0; i < windowSize; i++) {
			oBuf[oBuf.length-1] = inF[i] + oBuf.shift();
			owOBuf[owOBuf.length-1] = squaredWinF[i] + owOBuf.shift();
		}
	}

	
	function identity_phase_locking(mag, currInPh, prevInPh, prevOutPh, omega, RA, RS, instPhaseAdv, phTh) {
		var peak, prevPeak, reg, regStart, prevRegEnd, prevRegStart, d, i;
		phTh_idx = 0;

		for (i = 0; i < omega.length; i++) {
			expectedPhaseAdv = omega[i] * RA;

			auxHeterodynedPhaseIncr = (currInPh[i] - prevInPh[i]) - expectedPhaseAdv;
			heterodynedPhaseIncr = auxHeterodynedPhaseIncr - twoPI * Math.round(auxHeterodynedPhaseIncr/twoPI);

			instPhaseAdvPerSampleHop = omega[i] + heterodynedPhaseIncr / RA;

			instPhaseAdv_ = instPhaseAdvPerSampleHop * RS;

			if (mag[i] > Math.max((mag[i-2]|0), (mag[i-1]|0), (mag[i+1]|0), (mag[i+2]|0))) {
			// if (mag[i] > (mag[i-2]|0) && mag[i] > (mag[i-1]|0) && mag[i] > (mag[i+1]|0) && mag[i] > (mag[i+2]|0)) {
				peak = i;
				regStart = Math.ceil((prevPeak + peak)/2) | 0; 
				prevRegEnd = regStart-1;
				reg = Math.max(0, prevRegEnd - prevRegStart + 1);
				prevRegStart = regStart;
				for (d = 0; d < reg; d++, phTh_idx++) {
					phTh[phTh_idx] = prevOutPh[prevPeak] + prevInstPhaseAdv_ - currInPh[prevPeak];
				}
				prevPeak = peak;
				prevInstPhaseAdv_ = instPhaseAdv_;
			}
		}

		return;
	}


	function pv_step(fftObj, prevInPh, prevOutPh, omega, RA, RS, out) {

		var currInPh = fftObj.phase;
		var mag = fftObj.magnitude;
		var instPhaseAdv = _pv_step.instPhaseAdv;
		var phTh = _pv_step.phTh;

		var peak, prevPeak, reg, regStart, prevRegEnd, prevRegStart, d, i;
		phTh_idx = 0;

		for (i = 0; i < omega.length; i++) {
			expectedPhaseAdv = omega[i] * RA;

			auxHeterodynedPhaseIncr = (currInPh[i] - prevInPh[i]) - expectedPhaseAdv;
			heterodynedPhaseIncr = auxHeterodynedPhaseIncr - twoPI * Math.round(auxHeterodynedPhaseIncr/twoPI);

			instPhaseAdvPerSampleHop = omega[i] + heterodynedPhaseIncr / RA;

			instPhaseAdv_ = instPhaseAdvPerSampleHop * RS;

			if (mag[i] > Math.max((mag[i-2]|0), (mag[i-1]|0), (mag[i+1]|0), (mag[i+2]|0))) {
			// if (mag[i] > (mag[i-2]|0) && mag[i] > (mag[i-1]|0) && mag[i] > (mag[i+1]|0) && mag[i] > (mag[i+2]|0)) {
				peak = i;
				regStart = Math.ceil((prevPeak + peak)/2) | 0; 
				prevRegEnd = regStart-1;
				reg = Math.max(0, prevRegEnd - prevRegStart + 1);
				prevRegStart = regStart;
				for (d = 0; d < reg; d++, phTh_idx++) {
					phTh[phTh_idx] = prevOutPh[prevPeak] + prevInstPhaseAdv_ - currInPh[prevPeak];
				}
				prevPeak = peak;
				prevInstPhaseAdv_ = instPhaseAdv_;
			}
		}
		
		for (var i=0; i<phTh.length; i++) {
			var theta = phTh[i];

			var phThRe = cos(phTh[i]);
			var phThIm = sin(phTh[i]);
			
			out.real[i] = phThRe * fftObj.real[i] - phThIm * fftObj.imag[i];
			out.imag[i] = phThRe * fftObj.imag[i] + phThIm * fftObj.real[i];
			out.phase[i] = atan2(out.imag[i], out.real[i]);
		}
		
		return;
	}


	this.process = function(inputFrame) {

		var _ = this;

		var __RS = _RS;
		var __RA = _RA;

		// ----------------------------------
		// ----------ANALYSIS STEP-----------
		// ----------------------------------
		
		var processedFrame = _process.processedFrame;;
		var fftObj = _process.fftObj;
		// FOR SOME REASON, IF I DON'T CREATE A NEW "phase" ARRAY, I GET ARTIFACTS.
		// fftObj.phase = new Float32Array(_hlfSize); 
		var pvOut = _process.pvOut;
		_.STFT(inputFrame, _framingWindow, _hlfSize, fftObj);
		pv_step(fftObj, _previousInputPhase, _previousOutputPhase, _omega, __RA, __RS, pvOut);
		_previousOutputPhase = pvOut.phase;
		// The "phase" issue mentioned above is related to this line. 
		// If I create a new Float array using the phase array, I get no issues.
		_previousInputPhase = new Float32Array(fftObj.phase); 
		_.ISTFT(pvOut.real, pvOut.imag, _framingWindow, false, processedFrame);


		// ----------------------------------
		// ------OVERLAP AND SLIDE STEP------
		// ----------------------------------
		var outputFrame = new Array(__RS);

		overlap_and_slide(__RS, processedFrame, _squaredFramingWindow, _overlapBuffers, _owOverlapBuffers, _winSize, outputFrame);

		return outputFrame;

	}

	
	this.STFT = function(inputFrame, windowFrame, wantedSize, out) {
		this.STFT_drom(inputFrame, windowFrame, wantedSize, out);
	}

	this.STFT_drom = function(inputFrame, windowFrame, wantedSize, out) {
		var winSize = windowFrame.length;
		var _inputFrame = _STFT._inputFrame;

		for (var i=0; i<winSize; i++) {
			_inputFrame[i] = inputFrame[i] * windowFrame[i];
		}
		
		// fourier.js forward FFT 
		(new Float32Array(dromHeap)).set(_inputFrame);
		fourier.custom.array2heap(_STFT._zeros, new Float32Array(dromHeap), winSize, winSize);
		dromFFT.transform();
		fourier.custom.heap2array(new Float32Array(dromHeap), out.real, wantedSize, 0);
		fourier.custom.heap2array(new Float32Array(dromHeap), out.imag, wantedSize, winSize);

		for (var p=0; p<winSize && p<wantedSize; p++) {
			var R = out.real; var I = out.imag;
			var P = out.phase; var M = out.magnitude;
			M[p] = Math.sqrt(I[p]*I[p] + R[p]*R[p]) * 1000;
			P[p] = Math.atan2(I[p], R[p]);
		}

		return;
	}



	this.ISTFT = function(real, imag, windowFrame, restoreEnergy, timeFrame) {
		this.ISTFT_drom(real, imag, windowFrame, restoreEnergy, timeFrame);
	}

	this.ISTFT_drom = function(real, imag, windowFrame, restoreEnergy, timeFrame) {

		var size = windowFrame.length;

		(new Float32Array(dromHeap, 0, size)).set(imag);
		fourier.custom.array2heap(real, new Float32Array(dromHeap), size, size);
		dromFFT.transform();
		timeFrame.set(new Float32Array(dromHeap, size, size));

		for (var i=0; i<size; i++) {
			timeFrame[i] = timeFrame[i] / windowFrame.length;
			timeFrame[i] *= windowFrame[i];
		}

		return;

	}



	this.init = function() {

		_omega = create_omega_array(winSize);

		_previousInputPhase = create_constant_array(winSize/2, 0);
		_previousOutputPhase = create_constant_array(winSize/2, 0);

		_framingWindow = create_sin_beta_window_array(winSize, 1);

		_squaredFramingWindow = _framingWindow.map(function(x,i){ return x*x; });

		_overlapBuffers = create_constant_array(winSize, 0);
		_owOverlapBuffers = create_constant_array(winSize, 0);

		this.set_alpha(1);
	}

	function create_omega_array(size) {
		return Array.apply(null, Array(size/2 + 1)).map(function (x, i) { 
			return 2 * Math.PI * i / size;
		});
	}
	
	function create_sin_beta_window_array(size, beta) {
		return Array.apply(null, Array(size)).map(function(x,i){
			return Math.pow(Math.sin(Math.PI*i/size), beta);
		});
	}

	function create_constant_array(size, constant, ArrayType) {
		var arr = new ((ArrayType)?ArrayType:Array)(size);
		for (var i=0; i<size; i++) 
			arr[i] = constant;
		return arr;
	}

	this.reset_phases_and_overlap_buffers = function() {

		_previousInputPhase = create_constant_array(winSize/2, 0);
		_previousOutputPhase = create_constant_array(winSize/2, 0);

		_overlapBuffers = create_constant_array(winSize, 0);
		_owOverlapBuffers = create_constant_array(winSize, 0);

		_first = true;
	}

	this.reset_phases = function() {

		_previousInputPhase = create_constant_array(winSize/2, 0);
		_previousOutputPhase = create_constant_array(winSize/2, 0);

		_first = true;
	}


	this.get_previous_input_phase = function() {
		return _previousInputPhase;
	}

	this.get_previous_output_phase = function() {
		return _previousOutputPhase;
	}

	this.get_analysis_hop = function() {
		return _RA;
	}

	this.get_synthesis_hop = function() {
		return _RS;
	}

	this.get_alpha = function() {
		return _RS / _RA;
	}

	this.get_framing_window = function() {
		return _framingWindow;
	}

	this.get_squared_framing_window = function() {
		return _squaredFramingWindow;
	}

	this.set_alpha = function(newAlpha) {
		_lastInputAlpha = newAlpha;
		if (newAlpha <= 0.8)
			_overlapFactor = 2;
		else if (newAlpha <= 1)
			_overlapFactor = 4;
		else
			_overlapFactor = 5;
		_RA = Math.round(_winSize/_overlapFactor);
		_RS = Math.round(newAlpha * _RA);
		// _RS = _RA;
		// _RS = Math.round(_winSize/2);
		// _RA = Math.round(_RS / newAlpha);
	}

	this.get_alpha_step = function() {
		return 1/_RA;
	}

	this.set_hops = function(RA, RS) {
		_RA = RA;
		_RS = RS;
	}

	this.get_specified_alpha = function() {
		return _lastInputAlpha;
	}

	this.set_overlap_factor = function(overlapFactor) {
		_overlapFactor = overlapFactor;
		this.set_alpha(_lastInputAlpha);
	}
}