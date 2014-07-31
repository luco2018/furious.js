var util = require("./../util");
var jsmath = require("./jsmath");
var MaybeNDArray = require("./MaybeNDArray");
var DataType = require("./../DataType");
var requests = require("./../requests.pb");
var Request = requests.Request;
var EmptyArrayRequest = requests.EmptyArrayRequest;
var DataArrayRequest = requests.DataArrayRequest;
var ConstArrayRequest = requests.ConstArrayRequest;
var LinspaceRequest = requests.LinspaceRequest;
var ReshapeRequest = requests.ReshapeRequest;
var RepeatRequest = requests.RepeatRequest;
var DeallocateRequest = requests.DeallocateRequest;
var FetchRequest = requests.FetchRequest;
var BinaryOperationRequest = requests.BinaryOperationRequest;
var BinaryConstOperationRequest = requests.BinaryConstOperationRequest;
var UnaryOperationRequest = requests.UnaryOperationRequest;
var ReductionRequest = requests.ReductionRequest;
var AxisReductionRequest = requests.AxisReductionRequest;
var DotOperationRequest = requests.DotOperationRequest;
var responses = require("./../responses.pb");
var Response = responses.Response;
var FetchResponse = responses.FetchResponse;
var ErrorResponse = responses.ErrorResponse;
var InitResponse = responses.InitResponse;
var InfoResponse = responses.InfoResponse;

var idMap = {};

var dataTypeMap = {};
dataTypeMap[requests.DataType.FLOAT64] = new DataType("f64");
dataTypeMap[requests.DataType.FLOAT32] = new DataType("f32");

function createEmptyArray(requestId, idOut, shape, dataType) {
	if (idOut in idMap) {
		throw new Error("Invalid output ID");
	}
	shape = util.checkShape(shape);
	dataType = util.checkDataType(dataType);
	var arrayOut = new MaybeNDArray(shape, dataType, null);
	idMap[idOut] = arrayOut;
}

function createDataArray(requestId, idOut, shape, dataType, dataBuffer) {
	if (idOut in idMap) {
		throw new Error("Invalid output ID");
	}
	shape = util.checkShape(shape);
	dataType = util.checkDataType(dataType);
	var arrayOut = new MaybeNDArray(shape, dataType, dataBuffer);
	idMap[idOut] = arrayOut;
}

function createConstArray(requestId, idOut, shape, dataType, fillValue) {
	if (idOut in idMap) {
		throw new Error("Invalid output ID");
	}
	shape = util.checkShape(shape);
	dataType = util.checkDataType(dataType);
	var arrayOut = new MaybeNDArray(shape, dataType, null);
	if (arrayOut.hasData()) {
		if (fillValue !== 0.0) {
			jsmath.fill(arrayOut.data, fillValue);
		}
	}
	idMap[idOut] = arrayOut;
}

function linspace(requestId, idOut, start, stop, samples, closed, dataType) {
	if (idOut in idMap) {
		throw new Error("Invalid output ID");
	}
	if (!isFinite(start)) {
		throw new TypeError("start is not a real number");
	}
	if (!isFinite(stop)) {
		throw new TypeError("stop is not a real number");
	}
	if (samples === 0) {
		throw new RangeError("The number of samples must be positive");
	} else if (closed && (samples === 1)) {
		throw new RangeError("The number of samples must be a least 2 (for start and end points)");
	}
	var arrayOut = new MaybeNDArray([samples], dataType, null);
	var data = arrayOut.data;
	var range = stop - start;
	var n = (closed) ? samples - 1 : samples;
	var step = range / n;
	for (var i = 0; i < samples; i++) {
		data[i] = start + step * i;
	}
	idMap[idOut] = arrayOut;
}

function reshape(requestId, idA, idOut, shapeOut) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	if (arrayA.length !== util.computeLength(shapeOut)) {
		throw new Error("Incompatible length");
	}
	var arrayOut = idMap[idOut];
	if (typeof arrayOut !== "undefined") {
		if (arrayOut.length !== arrayA.length) {
			throw new Error("Incompatible length");
		}
		if (!arrayOut.dataType.equals(arrayA.dataType)) {
			throw new Error("Incompatible data type");
		}
		arrayOut.shape = shapeOut;
		if (arrayOut !== arrayA) {
			arrayOut.data.set(arrayA.data);
		}
		if (idA < 0) {
			delete idMap[-idA];
		}
	} else {
		if (idA < 0) {
			arrayA.shape = shapeOut;
			delete idMap[-idA];
			idMap[idOut] = arrayA;
		} else {
			arrayOut = new MaybeNDArray(shapeOut, arrayA.dataType, null);
			arrayOut.data.set(arrayA.data);
			idMap[idOut] = arrayOut;
		}
	}
}

function repeat(requestId, idA, idOut, axis, repeats) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	if (axis >= arrayA.shape.length) {
		throw new Error("Invalid axis");
	}
	if (repeats < 2) {
		throw new Error("Invalid repeat count");
	}
	var arrayOut = idMap[idOut];
	var shapeOut = arrayA.shape.slice(0);
	shapeOut[axis] *= repeats;
	if (typeof arrayOut !== "undefined") {
		/* Validate output array */
		if (arrayOut.shape.length !== shapeOut.length) {
			throw new Error("Incompatible number of dimensions");
		}
		for (var i = 0; i < shapeOut.length; ++i) {
			if (arrayOut.shape[i] !== shapeOut[i]) {
				throw new Error("Incompatible shape");
			}
		}
		if (!arrayOut.dataType.equals(arrayA.dataType)) {
			throw new Error("Incompatible data type");
		}
	} else {
		/* Allocate output array */
		arrayOut = new MaybeNDArray(shapeOut, arrayA.dataType, null);
		idMap[idOut] = arrayOut;
	}
	var outerStride = util.computeOuterStride(arrayA.shape, axis);
	var innerStride = util.computeInnerStride(arrayA.shape, axis);
	jsmath.repeat(arrayA.data, arrayOut.data, outerStride, innerStride, arrayA.shape[axis], repeats);
	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
}

function deallocate(requestId, idA) {
	var arrayA = idMap[idA];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	arrayA.deallocate();
	delete idMap[idA];
}

function fetch(requestId, idA) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}

	var response = new Response();
	response.id = requestId;
	response.type = Response.Type.FETCH;
	var fetchResponse = new FetchResponse();
	fetchResponse.dataBuffer = arrayA.data.buffer;
	response.fetchResponse = fetchResponse;
	var message = response.encodeAB();
	self.postMessage(message, [message]);

	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
}

function barrier(requestId) {
	var response = new Response();
	response.id = requestId;
	response.type = Response.Type.BARRIER;
	var message = response.encodeAB();
	self.postMessage(message, [message]);
}

binaryOperationMap = {};
binaryOperationMap[BinaryOperationRequest.Type.ADD] = jsmath.add;
binaryOperationMap[BinaryOperationRequest.Type.SUB] = jsmath.sub;
binaryOperationMap[BinaryOperationRequest.Type.MUL] = jsmath.mul;
binaryOperationMap[BinaryOperationRequest.Type.DIV] = jsmath.div;

function binaryOperation(requestId, type, idA, idB, idOut) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	var arrayB = idMap[Math.abs(idB)];
	if (typeof arrayB === "undefined") {
		throw new Error("Invalid input ID");
	}
	if (!arrayA.dataType.equals(arrayB.dataType)) {
		throw new Error("Incompatible data type");
	}
	if (!util.arrayEquals(arrayA.shape, arrayB.shape)) {
		throw new Error("Incompatible shapes");
	}
	var arrayOut = idMap[idOut];
	if (typeof arrayOut === "undefined") {
		arrayOut = new MaybeNDArray(arrayA.shape, arrayA.dataType, null);
		idMap[idOut] = arrayOut;
	} else {
		if (!arrayA.dataType.equals(arrayOut.dataType)) {
			throw new Error("Incompatible data type");
		}
		if (!util.arrayEquals(arrayA.shape, arrayOut.shape)) {
			throw new Error("Incompatible shapes");
		}
	}
	binaryOperationMap[type](arrayA.data, arrayB.data, arrayOut.data);
	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
	if (idB < 0) {
		arrayB.deallocate();
		delete idMap[-idB];
	}
}

binaryConstOperationMap = {};
binaryConstOperationMap[BinaryConstOperationRequest.Type.ADDC]  = jsmath.addConst;
binaryConstOperationMap[BinaryConstOperationRequest.Type.SUBC]  = jsmath.subConst;
binaryConstOperationMap[BinaryConstOperationRequest.Type.SUBRC] = jsmath.subRevConst;
binaryConstOperationMap[BinaryConstOperationRequest.Type.MULC]  = jsmath.mulConst;
binaryConstOperationMap[BinaryConstOperationRequest.Type.DIVC]  = jsmath.divConst;
binaryConstOperationMap[BinaryConstOperationRequest.Type.DIVRC] = jsmath.divRevConst;

function binaryConstOperation(requestId, type, idA, valueB, idOut) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	var arrayOut = idMap[idOut];
	if (typeof arrayOut === "undefined") {
		arrayOut = new MaybeNDArray(arrayA.shape, arrayA.dataType, null);
		idMap[idOut] = arrayOut;
	} else {
		if (!arrayA.dataType.equals(arrayOut.dataType)) {
			throw new Error("Incompatible data type");
		}
		if (!util.arrayEquals(arrayA.shape, arrayOut.shape)) {
			throw new Error("Incompatible shapes");
		}
	}
	binaryConstOperationMap[type](arrayA.data, valueB, arrayOut.data);
	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
}

unaryOperationMap = {};
unaryOperationMap[UnaryOperationRequest.Type.NEG]    = jsmath.neg;
unaryOperationMap[UnaryOperationRequest.Type.ABS]    = jsmath.abs;
unaryOperationMap[UnaryOperationRequest.Type.EXP]    = jsmath.exp;
unaryOperationMap[UnaryOperationRequest.Type.LOG]    = jsmath.log;
unaryOperationMap[UnaryOperationRequest.Type.SQRT]   = jsmath.sqrt;
unaryOperationMap[UnaryOperationRequest.Type.SQUARE] = jsmath.square;

function unaryOperation(requestId, type, idA, idOut) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	var arrayOut = idMap[idOut];
	if (typeof arrayOut === "undefined") {
		arrayOut = new MaybeNDArray(arrayA.shape, arrayA.dataType, null);
		idMap[idOut] = arrayOut;
	} else {
		if (!arrayA.dataType.equals(arrayOut.dataType)) {
			throw new Error("Incompatible data type");
		}
		if (!util.arrayEquals(arrayA.shape, arrayOut.shape)) {
			throw new Error("Incompatible shapes");
		}
	}
	unaryOperationMap[type](arrayA.data, arrayOut.data);
	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
}

reductionMap = {};
reductionMap[ReductionRequest.Type.SUM] = jsmath.sum;
reductionMap[ReductionRequest.Type.MAX] = jsmath.max;
reductionMap[ReductionRequest.Type.MIN] = jsmath.min;

function reduction(requestId, type, idA, idOut) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	var arrayOut = idMap[idOut];
	var shapeOut = [];
	if (typeof arrayOut === "undefined") {
		arrayOut = new MaybeNDArray(shapeOut, arrayA.dataType, null);
		idMap[idOut] = arrayOut;
	} else {
		if (!arrayA.dataType.equals(arrayOut.dataType)) {
			throw new Error("Incompatible data type");
		}
		if (!util.arrayEquals(shapeOut, arrayOut.shape)) {
			throw new Error("Incompatible shapes");
		}
	}
	reductionMap[type](arrayA.data, arrayOut.data);
	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
}

axisReductionMap = {};
axisReductionMap[AxisReductionRequest.Type.SUM] = jsmath.axisSum;
axisReductionMap[AxisReductionRequest.Type.MAX] = jsmath.axisMax;
axisReductionMap[AxisReductionRequest.Type.MIN] = jsmath.axisMin;

function axisReduction(requestId, type, idA, axis, idOut) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	if (axis >= arrayA.shape.length) {
		throw new Error("Invalid axis");
	}
	var shapeOut = util.computeAxisReductionOutShape(arrayA.shape, axis);
	var arrayOut = idMap[idOut];
	if (typeof arrayOut === "undefined") {
		arrayOut = new MaybeNDArray(shapeOut, arrayA.dataType, null);
		idMap[idOut] = arrayOut;
	} else {
		if (!arrayA.dataType.equals(arrayOut.dataType)) {
			throw new Error("Incompatible data type");
		}
		if (!util.arrayEquals(shapeOut, arrayOut.shape)) {
			throw new Error("Incompatible shapes");
		}
	}
	axisReductionMap[type](arrayA.data, arrayOut.data,
		util.computeOuterStride(arrayA.shape, axis),
		util.computeInnerStride(arrayA.shape, axis),
		arrayA.shape[axis]);
	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
}

function dotOperation(requestId, type, idA, idB, idOut) {
	var arrayA = idMap[Math.abs(idA)];
	if (typeof arrayA === "undefined") {
		throw new Error("Invalid input ID");
	}
	var arrayB = idMap[Math.abs(idB)];
	if (typeof arrayB === "undefined") {
		throw new Error("Invalid input ID");
	}
	if (!arrayA.dataType.equals(arrayB.dataType)) {
		throw new Error("Incompatible data type");
	}

	/* The axis of b used in reduction: axis 0 for 1D array, second-to-last axis for ND array */
	var axisA = Math.max(arrayA.shape.length - 1, 0);
	var axisB = Math.max(arrayB.shape.length - 2, 0);
	var reductionDim = arrayA.shape[axisA];
	if (reductionDim !== arrayB.shape[axisB]) {
		throw new RangeError("Arrays have incompatible reduction dimensions");
	}
	var shapeOut = [], strideA = 1, outerStrideB = 1, innerStrideB = 1;
	for (var i = 0; i < axisA; i++) {
		shapeOut.push(arrayA.shape[i]);
		strideA *= arrayA.shape[i];
	}
	for (var i = 0; i < arrayB.shape.length; i++) {
		var dim = arrayB.shape[i];
		if (i < axisB) {
			outerStrideB *= dim;
			shapeOut.push(dim);
		} else if (i > axisB) {
			innerStrideB *= dim;
			shapeOut.push(dim);
		}
	}
	var arrayOut = idMap[idOut];
	if (typeof arrayOut === "undefined") {
		arrayOut = new MaybeNDArray(shapeOut, arrayA.dataType, null);
		idMap[idOut] = arrayOut;
	} else {
		if (!arrayOut.dataType.equals(arrayA.dataType)) {
			throw new Error("Incompatible data type");
		}
		if (!util.arrayEquals(shapeOut, arrayOut.shape)) {
			throw new Error("Incompatible shape");
		}
	}
	jsmath.dot(arrayA.data, arrayB.data, arrayOut.data,
		strideA, outerStrideB, innerStrideB, reductionDim);
	if (idA < 0) {
		arrayA.deallocate();
		delete idMap[-idA];
	}
	if (idB < 0) {
		arrayB.deallocate();
		delete idMap[-idB];
	}
}

function init() {
	var response = new Response();
	response.id = 0;
	response.type = Response.Type.INIT;
	var initResponse = new InitResponse();
	response.initResponse = initResponse;
	var message = response.encodeAB();
	self.postMessage(message, [message]);
}

function onMessage(event) {
	var message = event.data;
	var request = Request.decode(message);
	switch (request.type) {
		case Request.Type.EMPTY_ARRAY:
			var emptyArrayRequest = request.emptyArrayRequest;
			createEmptyArray(request.id,
				emptyArrayRequest.idOut,
				emptyArrayRequest.shape,
				dataTypeMap[emptyArrayRequest.dataType]);
			break;
		case Request.Type.DATA_ARRAY:
			var dataArrayRequest = request.dataArrayRequest;
			createDataArray(request.id,
				dataArrayRequest.idOut,
				dataArrayRequest.shape,
				dataTypeMap[dataArrayRequest.dataType],
				dataArrayRequest.dataBuffer.toArrayBuffer());
			break;
		case Request.Type.CONST_ARRAY:
			var constArrayRequest = request.constArrayRequest;
			createConstArray(request.id,
				constArrayRequest.idOut,
				constArrayRequest.shape,
				dataTypeMap[constArrayRequest.dataType],
				constArrayRequest.fillValue);
			break;
		case Request.Type.LINSPACE:
			var linspaceRequest = request.linspaceRequest;
			linspace(request.id,
				linspaceRequest.idOut,
				linspaceRequest.start,
				linspaceRequest.stop,
				linspaceRequest.samples,
				linspaceRequest.closed,
				dataTypeMap[linspaceRequest.dataType]);
			break;
		case Request.Type.RESHAPE:
			var reshapeRequest = request.reshapeRequest;
			reshape(request.id,
				reshapeRequest.idA,
				reshapeRequest.idOut,
				reshapeRequest.shapeOut);
			break;
		case Request.Type.REPEAT:
			var repeatRequest = request.repeatRequest;
			repeat(request.id,
				repeatRequest.idA,
				repeatRequest.idOut,
				repeatRequest.axis,
				repeatRequest.repeats);
			break;
		case Request.Type.DEALLOCATE:
			var deallocateRequest = request.deallocateRequest;
			deallocate(request.id,
				deallocateRequest.idA);
			break;
		case Request.Type.FETCH:
			var fetchRequest = request.fetchRequest;
			fetch(request.id,
				fetchRequest.idA);
			break;
		case Request.Type.BARRIER:
			barrier(request.id);
			break;
		case Request.Type.INFO:
			break;
		case Request.Type.BINARY_OPERATION:
			var binaryOperationRequest = request.binaryOperationRequest;
			binaryOperation(request.id,
				binaryOperationRequest.type,
				binaryOperationRequest.idA,
				binaryOperationRequest.idB,
				binaryOperationRequest.idOut);
			break;
		case Request.Type.BINARY_CONST_OPERATION:
			var binaryConstOperationRequest = request.binaryConstOperationRequest;
			binaryConstOperation(request.id,
				binaryConstOperationRequest.type,
				binaryConstOperationRequest.idA,
				binaryConstOperationRequest.valueB,
				binaryConstOperationRequest.idOut);
			break;
		case Request.Type.UNARY_OPERATION:
			var unaryOperationRequest = request.unaryOperationRequest;
			unaryOperation(request.id,
				unaryOperationRequest.type,
				unaryOperationRequest.idA,
				unaryOperationRequest.idOut);
			break;
		case Request.Type.REDUCTION_OPERATION:
			var reductionRequest = request.reductionRequest;
			reduction(request.id,
				reductionRequest.type,
				reductionRequest.idA,
				reductionRequest.idOut);
			break;
		case Request.Type.AXIS_REDUCTION_OPERATION:
			var axisReductionRequest = request.axisReductionRequest;
			axisReduction(request.id,
				axisReductionRequest.type,
				axisReductionRequest.idA,
				axisReductionRequest.axis,
				axisReductionRequest.idOut);
			break;
		case Request.Type.DOT_OPERATION:
			var dotOperationRequest = request.dotOperationRequest;
			dotOperation(request.id,
				dotOperationRequest.type,
				dotOperationRequest.idA,
				dotOperationRequest.idB,
				dotOperationRequest.idOut);
			break;
	}
}

self.addEventListener("message", onMessage, false);
init();