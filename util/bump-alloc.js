// Shared-memory memory management: a very basic library for bump allocation.
// lhansen@mozilla.com / 2 December 2014.
//
// Usage:
//
// Create an alloator on SharedArrayBuffer with "new SharedBumpAlloc()".
//   The allocator can be initialized on both master and workers and
//   will be thread-safe.
//
// The allocator has accessors for shared TypedArrays of every type,
//   eg, m.Int32Array gets you the Int32Array mapped onto the
//   memory.  These arrays all alias though they may overlap only with
//   a subrange of the shared memory (overhead, alignment).
//
// The allocator has methods for allocating ranges of elements within
//   the various typed arrays, eg, m.allocInt32(n) will allocate n
//   consecutive Int32 values.  In this case the value returned from
//   the allocator is an index within m.Int32Array.  If the value
//   returned is 0 then the allocation failed.
//
// The allocator has utility methods for allocating ranges of elements
//   within the shared memory as shared typed arrays, eg,
//   m.allocInt32Array(n) will bump-allocate memory for an n-element
//   shared Int32Array and return a new array object.  If the value
//   returned is null then the allocation failed.
//
// There is no facility for freeing individual objects.
//
// Allocation is linear in the heap.
//
// Use the "mark" method to obtain the current allocation pointer and
//   the "release" method to reset the allocation pointer to a
//   captured pointer.  The pointer is an integer.
//
// Any agent can allocate, mark, and reset.  Watch your step: marking
//   and resetting are racy operations that are best done by the
//   master when it knows the workers are quiescent.

// Create a memory manager on a piece of shared memory.
//
// "sab" is a SharedArrayBuffer.
// "byteOffset" is an offset within sab where the available memory starts.
//    This will be rounded up by the memmgr to an 8-byte boundary.
// "bytesAvail" is the number of bytes in sab starting at byteOffset
//    available exclusively to the memmgr.  This number will be rounded
//    down by the memmgr to an 8-byte boundary.
// "who" is a string, either "master" or "worker".
//
// Apart for "who" the arguments passed to the constructor on the
// master and workers should be the same.
//
// The construction of the SharedBumpAlloc on the master must be complete
// before the construction is started on the workers.
//
// Storage sizing:
//  - If byteOffset and bytesAvail are both divisible by eight then no
//    rounding will take place.
//  - The allocator will use a few bytes words of shared memory
//    for its own data structures; the value SharedBumpAlloc.NUMBYTES
//    will provide the number of bytes.
//  - There is no per-object overhead (headers or similar), but
//    allocations are rounded up to an 8-byte boundary.
//
// Thus, if the application precomputes the peak number of bytes
// needed for the its objects and factors in alignment and allocator
// overhead appropriately then it can pre-allocate a SharedArrayBuffer
// with tight bounds and count on it being large enough.
//
// space available for storage.

const _SBA_METAWORDS = 2;	// Must be even.  Metadata + "page zero" buffer to make 0 an illegal pointer
const _SBA_TOP = 0;		// Allocation pointer index in metadata
const _SBA_LIMIT = 1;		// Allocation limit index in metadata
const _SBA_PAGEZEROSZ = 8;	// Number of bytes in unused space
const _SBA_NUMBYTES = _SBA_METAWORDS*4 + _SBA_PAGEZEROSZ;

function SharedBumpAlloc(sab, byteOffset, bytesAvail, who) {
    var adjustedByteOffset = (byteOffset + 7) & ~7;
    var adjustedLimit = (byteOffset + bytesAvail) & ~7;
    var baseOffset = adjustedByteOffset + _SBA_METAWORDS*4;
    var adjustedBytesAvail = adjustedLimit - baseOffset;

    this._meta = new Int32Array(sab, adjustedByteOffset, _SBA_METAWORDS);

    this._int8Array = new Int8Array(sab, baseOffset, adjustedBytesAvail);
    this._uint8Array = new Uint8Array(sab, baseOffset, adjustedBytesAvail);
    this._int16Array = new Int16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._uint16Array = new Uint16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._int32Array = new Int32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._uint32Array = new Uint32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float32Array = new Float32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float64Array = new Float64Array(sab, baseOffset, adjustedBytesAvail >> 3);

    this._limit = adjustedLimit - baseOffset;	// Cache this, it doesn't change
    this._sab = sab;
    this._baseOffset = baseOffset;

    switch (who) {
    case "master":
	// Make '0' an illegal address without exposing metadata.
	this._meta[_SBA_TOP] = _SBA_PAGEZEROSZ;
	this._meta[_SBA_LIMIT] = adjustedLimit;
	break;
    case "worker":
	break;
    default:
	throw new Error("Bad agent designator: " + who);
    }
}

// The number of bytes needed for the allocator's internal data.

SharedBumpAlloc.NUMBYTES = _SBA_NUMBYTES;

// The SharedBumpAlloc object has the following accessors:
//
//   Int8Array
//   Uint8Array
//   Int16Array
//   Uint16Array
//   Int32Array
//   Uint32Array
//   Float32Array
//   Float64Array
//
// The arrays returned from these all overlap completely (but the
// length values will only be the same for same-basetype arrays, of
// course).

Object.defineProperties(SharedBumpAlloc.prototype,
			{ Int8Array: { get: function () { return this._int8Array; } },
			  Uint8Array: { get: function () { return this._uint8Array; } },
			  Int16Array: { get: function () { return this._int16Array; } },
			  Uint16Array: { get: function () { return this._uint16Array; } },
			  Int32Array: { get: function () { return this._int32Array; } },
			  Uint32Array: { get: function () { return this._uint32Array; } },
			  Float32Array: { get: function () { return this._float32Array; } },
			  Float64Array: { get: function () { return this._float64Array; } } });

// PRIVATE.  Returns an integer byte offset within the sab for nbytes
// of storage, aligned on an 8-byte boundary.  Returns 0 on allocation
// error.

SharedBumpAlloc.prototype._allocBytes =
    function (nbytes) {
	const meta = this._meta;
	const limit = this._limit;
	nbytes = (nbytes + 7) & ~7;
	// There's an alternative protocol here that adds unconditionally and then checks
	// for overflow, and if there was overflow subtracts and returns zero.  It has
	// fewer atomic ops in the common case.  But this approach can trigger spurious
	// error returns in other threads.
	var x = Atomics.load(meta, _SBA_TOP);
	do {
	    p = x;
	    var newtop = p+nbytes;
	    if (newtop > limit)
		return 0;
	} while ((x = Atomics.compareExchange(meta, _SBA_TOP, p, newtop)) != p);
	return p;
    };

// Allocators.  These will round the request up to eight bytes.
// Returns an index within Int32Array / Uint32Array, or 0 on memory-full.

SharedBumpAlloc.prototype.allocInt8 =
    function (nelements) {
	return this._allocBytes(nelements);
    };

SharedBumpAlloc.prototype.allocUint8 =
    SharedBumpAlloc.prototype.allocInt8;

SharedBumpAlloc.prototype.allocInt16 =
    function (nelements) {
	return this._allocBytes(nelements*2) >> 1;
    };

SharedBumpAlloc.prototype.allocUint16 =
    SharedBumpAlloc.prototype.allocInt16;

SharedBumpAlloc.prototype.allocInt32 =
    function (nelements) {
	return this._allocBytes(nelements*4) >> 2;
    };

SharedBumpAlloc.prototype.allocUint32 =
    SharedBumpAlloc.prototype.allocInt32;

SharedBumpAlloc.prototype.allocFloat32 =
    SharedBumpAlloc.prototype.allocInt32;

SharedBumpAlloc.prototype.allocFloat64 =
    function (nelements) {
	return this._allocBytes(nelements*8) >> 3;
    };

// Convenient methods for allocating array data directly.  These
// return null on OOM and otherwise a SharedTypedArray.

SharedBumpAlloc.prototype.allocInt8Array =
    function (nelements) {
	var p = this.allocInt8(nelements);
	if (!p)
	    return null;
	return new Int8Array(this._sab, this._baseOffset + p, nelements);
    };

SharedBumpAlloc.prototype.allocUint8Array =
    function (nelements) {
	var p = this.allocUint8(nelements);
	if (!p)
	    return null;
	return new Uint8Array(this._sab, this._baseOffset + p, nelements);
    };

SharedBumpAlloc.prototype.allocInt16Array =
    function (nelements) {
	var p = this.allocInt16(nelements);
	if (!p)
	    return null;
	return new Int16Array(this._sab, this._baseOffset + (p << 1), nelements);
    };

SharedBumpAlloc.prototype.allocUint16Array =
    function (nelements) {
	var p = this.allocUint16(nelements);
	if (!p)
	    return null;
	return new Uint16Array(this._sab, this._baseOffset + (p << 1), nelements);
    };

SharedBumpAlloc.prototype.allocInt32Array =
    function (nelements) {
	var p = this.allocInt32(nelements);
	if (!p)
	    return null;
	return new Int32Array(this._sab, this._baseOffset + (p << 2), nelements);
    };

SharedBumpAlloc.prototype.allocUint32Array =
    function (nelements) {
	var p = this.allocUint32(nelements);
	if (!p)
	    return null;
	return new Uint32Array(this._sab, this.baseOffset + (p << 2), nelements);
    };

SharedBumpAlloc.prototype.allocFloat32Array =
    function (nelements) {
	var p = this.allocFloat32(nelements);
	if (!p)
	    return null;
	return new Float32Array(this._sab, this.baseOffset + (p << 2), nelements);
    };

SharedBumpAlloc.prototype.allocFloat64Array =
    function (nelements) {
	var p = this.allocFloat64(nelements);
	if (!p)
	    return null;
	return new Float64Array(this._sab, this.baseOffset + (p << 3), nelements);
    };

// Mark is a synchronization point.  The returned value is never 0.

SharedBumpAlloc.prototype.mark =
    function () {
	return Atomics.load(this._meta, _SBA_TOP);
    };

// Release is a synchronization point

SharedBumpAlloc.prototype.release =
    function (p) {
	const meta = this._meta;
	if ((p|0) !== p || p < 0 || p > this._int8Array.length)
	    throw new Error("Unlikely heap marker: " + p);
	Atomics.store(meta, _SBA_TOP, p);
    };
