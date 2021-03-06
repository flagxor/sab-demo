This is a variation on a program whose program notes appear below.

This variation allows the toggling of PJS, Web Workers with shared
memory, and sequential computation.

There are several advantages with web workers we're not currently
making use of:

  - we can update shared memory, so there's no need for the difficult
    post-render loop, we can just blit the data from one to the other
    if we set things up properly

  - we can overlap display of one frame with the computation of the
    next frame

----------------------------------------

Here are several variations on a benchmark from Intel that renders a
MineCraft-like world procedurally.

The file renderWorld.html loads renderWorld.js by default.

The *headless* versions are equivalent to the corresponding versions
without that annotation.

The current version of renderWorld.js is tuned for good performance
using data structures that interact well with PJS (a plain Array
holding ints); the parallel version executes at almost 2x the frame
rate over the sequential version on an AMD quad-core, and at more than
2x the frame rate over the sequential version on an Intel quad-core
with HyperThreading.

renderWorld-to.js is a TypedObject variant of renderWorld.js, it has
nearly the same performance but is prone to significantly longer GC
pauses, I assume the GC does not handle TypedObject arrays as well as
it handles regular arrays.

renderWorld-to-struct.js is a variant of renderWorld-to.js that uses
an array of structs for the RGB values, and stores into that array
through a cursor.  It is closest in spirit to the original program
(below).  It is a bit slower than renderWorld-to.js (though still
plenty faster than the sequential code) and has even more pronounced
GC pauses.

renderWorld-rgbobj.js is an earlier attempt, it parallelizes well but
the amount of storage allocated by the kernel and tenured into the
general heap is large because it uses small objects to hold RGB
values.  Though it is much faster than the original, the parallel
version trails the sequential version by a good bit (26fps vs 33fps on
the AMD).

renderWorld-orig.js is the original program, it does not parallelize
well at the moment because the PJS engine does not handle its data
structure (2D array, looks like).
