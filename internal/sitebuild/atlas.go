package sitebuild

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
)

// Display-only derivative. The 512px originals and their source records stay in
// assets; one 2x atlas avoids dozens of browser requests without a runtime loader.
func Atlas(paths []string, images [][]byte) ([]byte, []byte, error) {
	const size = 96
	const columns = 8
	rows := (len(paths) + columns - 1) / columns
	if rows == 0 {
		return nil, nil, nil
	}
	sheet := image.NewNRGBA(image.Rect(0, 0, columns*size, rows*size))
	var css bytes.Buffer
	fmt.Fprintf(&css, "\n.site-icon.sprite{position:relative}.site-icon.sprite img.atlas{position:absolute;max-width:none;width:calc(var(--icon-size)*%d);height:calc(var(--icon-size)*%d);object-fit:fill;background:transparent;left:0;top:0}\n", columns, rows)
	for i, path := range paths {
		source, e := png.Decode(bytes.NewReader(images[i]))
		if e != nil {
			return nil, nil, e
		}
		col, row := i%columns, i/columns
		for y := 0; y < size; y++ {
			for x := 0; x < size; x++ {
				// Area averaging uses premultiplied values to avoid halos at transparent edges.
				x0, x1 := float64(x)*512/size, float64(x+1)*512/size
				y0, y1 := float64(y)*512/size, float64(y+1)*512/size
				var rr, gg, bb, aa, total float64
				for sy := int(y0); sy < int(math.Ceil(y1)); sy++ {
					for sx := int(x0); sx < int(math.Ceil(x1)); sx++ {
						weight := (math.Min(x1, float64(sx+1)) - math.Max(x0, float64(sx))) * (math.Min(y1, float64(sy+1)) - math.Max(y0, float64(sy)))
						r, g, b, a := source.At(sx, sy).RGBA()
						rr += float64(r) * weight
						gg += float64(g) * weight
						bb += float64(b) * weight
						aa += float64(a) * weight
						total += weight
					}
				}
				pixel := color.NRGBA{}
				if aa > 0 {
					pixel = color.NRGBA{R: uint8(math.Round(rr / aa * 255)), G: uint8(math.Round(gg / aa * 255)), B: uint8(math.Round(bb / aa * 255)), A: uint8(math.Round(aa / total / 257))}
				}
				sheet.SetNRGBA(col*size+x, row*size+y, pixel)
			}
		}
		fmt.Fprintf(&css, ".site-icon.sprite[data-icon=%q] img.atlas{left:calc(var(--icon-size)*-%d);top:calc(var(--icon-size)*-%d)}\n", path, col, row)
	}
	var output bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if e := encoder.Encode(&output, sheet); e != nil {
		return nil, nil, e
	}
	return output.Bytes(), css.Bytes(), nil
}
