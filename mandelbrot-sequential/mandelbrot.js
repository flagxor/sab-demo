// Center the image at this location.
const g_center_x = -0.743643887037158704752191506114774;
const g_center_y = 0.131825904205311970493132056385139;

// Pixel grid.  (0,0) correspons to (bottom,left)
const height = 480;
const width = 640;

// Set this to larger values to zoom in on the center.
const magnification = 100;

const mem = new Int32Array(height*width);

function doMandelbrot() {
    mandelbrot(mem, 0, height, 0, width, magnification);
    return mem;
}

// Maximum iterations per pixel.
const MAXIT = 1000;

// Colors are ABGR with A=255.
const colors = [0xFFFF0700, 0xFF2a2aa5, 0xFFFFff00, 0xFFa19eff,
		0xFF00eefd, 0xFF008000, 0xFFFAFEFE, 0xFF00FFBF];

// Compute a square of pixels into mem with y in [ybase, ylimit)
// and x in [xbase, xlimit).

function mandelbrot(mem, ybase, ylimit, xbase, xlimit, magnification) {
    const g_top = g_center_y + 1/magnification;
    const g_bottom = g_center_y - 1/magnification;
    const g_left = g_center_x - width/height*1/magnification;
    const g_right = g_center_x + width/height*1/magnification;
    for ( var Py=ybase ; Py < ylimit ; Py++ ) {
	for ( var Px=xbase ; Px < xlimit ; Px++ ) {
	    var x0 = g_left+(Px/width)*(g_right-g_left);
	    var y0 = g_bottom+(Py/height)*(g_top-g_bottom);
	    var x = 0.0;
	    var y = 0.0;
	    var it = 0;
	    while (x*x + y*y < 4.0 && it < MAXIT) {
		var xtemp = x*x - y*y + x0;
		y = 2.0*x*y + y0;
		x = xtemp;
		it++;
	    }
	    mem[Py*width+Px] = it == MAXIT ? 0xFF000000 : colors[it & 7];
	}
    }
}
