import '~/scene/graphics/init';
import { AlphaFilter } from '../defaults/alpha/AlphaFilter';
import { getWebGLRenderer } from '@test-utils';
import { TexturePool } from '~/rendering';
import { Container, Graphics } from '~/scene';

import type { Renderer, RendererOptions } from '~/rendering';

const SIZE = 256;

// a filter at 0.5 alpha of #44aaff over a #222222 background
const BACKGROUND = [34, 34, 34];
const BLENDED = [51, 102, 145];

type CreateRenderer = (options: Partial<RendererOptions>) => Promise<Renderer>;

/**
 * Reads back what a render left on the canvas, in physical pixels.
 * @param renderer - the renderer that owns the canvas
 */
function readCanvas(renderer: Renderer): { pixels: Uint8ClampedArray, width: number }
{
    const { width, height } = renderer.canvas;
    const copy = document.createElement('canvas');

    copy.width = width;
    copy.height = height;

    const context = copy.getContext('2d', { willReadFrequently: true });

    context.drawImage(renderer.canvas as HTMLCanvasElement, 0, 0);

    return { pixels: context.getImageData(0, 0, width, height).data, width };
}

/**
 * Reads the colour of a single canvas pixel, in CSS coordinates.
 * @param renderer - the renderer that owns the canvas
 * @param x - the x position of the pixel
 * @param y - the y position of the pixel
 */
function readPixel(renderer: Renderer, x: number, y: number): number[]
{
    const { pixels, width } = readCanvas(renderer);
    const resolution = renderer.resolution;
    const offset = ((Math.floor(y * resolution) * width) + Math.floor(x * resolution)) * 4;

    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

function expectPixel(renderer: Renderer, x: number, y: number, expected: number[]): void
{
    const pixel = readPixel(renderer, x, y);

    expected.forEach((value, channel) => expect(Math.abs(pixel[channel] - value)).toBeLessThanOrEqual(1));
}

function viewportSuite(createRenderer: CreateRenderer): void
{
    it('should clip a single filter to the viewport at the renderer resolution', async () =>
    {
        const renderer = await createRenderer({ width: SIZE, height: SIZE, resolution: 1, background: '#222222' });
        const stage = new Container();
        // a filter resolution above the renderer's must not shrink the area the viewport clips to
        const filter = new AlphaFilter({ alpha: 0.5, resolution: 2 });
        // reaches past the right edge of the canvas, so the viewport clips it
        const square = new Graphics().rect(200, 0, 100, SIZE).fill('#44aaff');

        square.filters = [filter];
        stage.addChild(square);

        try
        {
            renderer.render(stage);

            expectPixel(renderer, 220, 128, BLENDED);
            expectPixel(renderer, 100, 128, BACKGROUND);
        }
        finally
        {
            stage.destroy({ children: true });
            filter.destroy();
            TexturePool.clear();
            renderer.destroy();
        }
    });

    const childResolutions: [string, number | 'inherit'][] = [
        ['a lower', 1],
        ['an inherited', 'inherit'],
        ['a higher', 3],
    ];

    it.each(childResolutions)('should not clip a nested filter by the parent resolution with %s child resolution', async (
        _label,
        childResolution,
    ) =>
    {
        const renderer = await createRenderer({ width: SIZE, height: SIZE, resolution: 1, background: '#222222' });
        const parent = new Container();
        const parentFilter = new AlphaFilter({ alpha: 1, resolution: 2 });
        const childFilter = new AlphaFilter({ alpha: 0.5, resolution: childResolution });
        // straddles the line the viewport would be clipped to if the parent resolution of 2
        // were wrongly used to scale it: 256 / 2 = 128
        const child = new Graphics().rect(100, 0, 100, SIZE).fill('#44aaff');

        parent.filters = [parentFilter];
        child.filters = [childFilter];
        parent.addChild(child);

        try
        {
            renderer.render(parent);

            expectPixel(renderer, 110, 128, BLENDED);
            expectPixel(renderer, 150, 128, BLENDED);
            expectPixel(renderer, 50, 128, BACKGROUND);
            expectPixel(renderer, 220, 128, BACKGROUND);
        }
        finally
        {
            parent.destroy({ children: true });
            parentFilter.destroy();
            childFilter.destroy();
            TexturePool.clear();
            renderer.destroy();
        }
    });

    it('should not drop a nested filter that lies fully past the parent-scaled viewport', async () =>
    {
        const renderer = await createRenderer({ width: SIZE, height: SIZE, resolution: 1, background: '#222222' });
        const parent = new Container();
        const parentFilter = new AlphaFilter({ alpha: 1, resolution: 2 });
        const childFilter = new AlphaFilter({ alpha: 0.5, resolution: 1 });
        // fully past 256 / 2 = 128, where a parent-scaled viewport clips the bounds to nothing
        const child = new Graphics().rect(150, 0, 100, SIZE).fill('#44aaff');

        parent.filters = [parentFilter];
        child.filters = [childFilter];
        parent.addChild(child);

        try
        {
            renderer.render(parent);

            expectPixel(renderer, 200, 128, BLENDED);
            expectPixel(renderer, 100, 128, BACKGROUND);
        }
        finally
        {
            parent.destroy({ children: true });
            parentFilter.destroy();
            childFilter.destroy();
            TexturePool.clear();
            renderer.destroy();
        }
    });
}

describe('FilterSystem viewport clipping with WebGL', () =>
{
    viewportSuite(getWebGLRenderer);
});
