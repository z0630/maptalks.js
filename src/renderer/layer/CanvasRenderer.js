import { now, isNil, isArrayHasData, isSVG, IS_NODE, loadImage } from 'core/util';
import Class from 'core/Class';
import Browser from 'core/Browser';
import Promise from 'core/Promise';
import Canvas2D from 'core/Canvas';
import Point from 'geo/Point';

/**
 * @classdesc
 * Base Class to render layer on HTMLCanvasElement
 * @abstract
 * @protected
 * @memberOf renderer
 * @extends Class
 */
class CanvasRenderer extends Class {

    /**
     * @param  {Layer} layer the layer to render
     */
    constructor(layer) {
        super();
        this.layer = layer;
        this._drawTime = 0;
        this.setToRedraw();
    }


    /**
     * Render the layer.
     * Call checkResources
     */
    render() {
        this.prepareRender();
        if (!this.getMap() || !this.layer.isVisible()) {
            return;
        }
        if (!this.resources) {
            /* eslint-disable no-use-before-define */
            this.resources = new ResourceCache();
            /* eslint-enable no-use-before-define */
        }
        if (this.checkResources) {
            const resources = this.checkResources();
            if (resources.length > 0) {
                this._loadingResource = true;
                this.loadResources(resources).then(() => {
                    this._loadingResource = false;
                    if (this.layer) {
                        /**
                         * resourceload event, fired when external resources of the layer complete loading.
                         *
                         * @event Layer#resourceload
                         * @type {Object}
                         * @property {String} type     - resourceload
                         * @property {Layer} target    - layer
                         */
                        this.layer.fire('resourceload');
                        this.setToRedraw();
                    }
                });
            } else {
                this._tryToDraw(this);
            }
        } else {
            this._tryToDraw(this);
        }
    }

    /**
     * Check if has any external resources to load
     * If yes, load the resources before calling draw method
     * @abstract
     * @method checkResources
     * @instance
     * @returns {Array[]} an array of resource arrays [ [url1, width, height], [url2, width, height], [url3, width, height] .. ]
     */

    /**
     * a required abstract method to implement
     * draw the layer when map is not interacting
     * @abstract
     * @instance
     * @method draw
     */

    /**
     * an optional abstract method to implement
     * draw the layer when map is interacting (moving/zooming/dragrotating)
     * @abstract
     * @instance
     * @method drawOnInteracting
     * @param {Object} eventParam event parameters
     */

    /**
     * Ask whether the layer renderer needs to redraw
     * @return {Boolean}
     */
    needToRedraw() {
        if (this._loadingResource) {
            return false;
        }
        if (this._toRedraw) {
            return true;
        }
        if (!this.drawOnInteracting) {
            return false;
        }
        const map = this.getMap();
        if (map.isInteracting()) {
            // don't redraw when map is moving without any pitch
            return !(!map.getPitch() && map.isMoving() && !map.isZooming() && !map.isRotating() && !this.layer.options['forceRenderOnMoving']);
        }
        return false;
    }

    /**
     * A callback for overriding when drawOnInteracting is skipped due to low fps
     */
    onSkipDrawOnInteracting() {

    }

    isRenderComplete() {
        return !!this._renderComplete;
    }

    /**
     * Set to redraw, ask map to call draw/drawOnInteracting to redraw the layer
     */
    setToRedraw() {
        this._toRedraw = true;
        return this;
    }

    /**
     *  Mark layer's canvas updated
     */
    setCanvasUpdated() {
        this._canvasUpdated = true;
        return this;
    }

    /**
     * Only called by map's renderer to check whether the layer's canvas is updated
     * @private
     * @return {Boolean}
     */
    isCanvasUpdated() {
        return !!this._canvasUpdated;
    }

    /**
     * Remove the renderer, will be called when layer is removed
     */
    remove() {
        if (this.onRemove) {
            this.onRemove();
        }
        delete this._loadingResource;
        delete this._northWest;
        delete this.canvas;
        delete this.context;
        delete this._extent2D;
        delete this.resources;
        delete this.layer;
    }

    /**
     * Get map
     * @return {Map}
     */
    getMap() {
        if (!this.layer) {
            return null;
        }
        return this.layer.getMap();
    }

    /**
     * Get renderer's Canvas image object
     * @return {HTMLCanvasElement}
     */
    getCanvasImage() {
        this._canvasUpdated = false;
        if (this._renderZoom !== this.getMap().getZoom() || !this.canvas || !this._extent2D) {
            return null;
        }
        if (this.isBlank()) {
            return null;
        }
        if (this.layer.isEmpty && this.layer.isEmpty()) {
            return null;
        }
        const map = this.getMap(),
            size = this._extent2D.getSize(),
            containerPoint = map._pointToContainerPoint(this._northWest);
        return {
            'image': this.canvas,
            'layer': this.layer,
            'point': containerPoint,
            'size': size
        };
    }

    /**
     * Clear canvas
     */
    clear() {
        this.clearCanvas();
    }

    /**
     * A method to help improve performance.
     * If you are sure that layer's canvas is blank, returns true to save unnecessary layer works of maps.
     * @return {Boolean}
     */
    isBlank() {
        if (!this._painted) {
            return true;
        }
        return false;
    }

    /**
     * Show the layer
     */
    show() {
        this.setToRedraw();
    }

    /**
     * Hide the layer
     */
    hide() {
        this.clear();
        this.setToRedraw();
    }

    /**
     * Set z-index of layer
     */
    setZIndex(/*z*/) {
        this.setToRedraw();
    }

    /**
     * Detect if there is anything painted on the given point
     * @param  {Point} point containerPoint
     * @return {Boolean}
     */
    hitDetect(point) {
        if (!this.context || (this.layer.isEmpty && this.layer.isEmpty()) || this.isBlank() || this._errorThrown) {
            return false;
        }
        const map = this.getMap();
        const size = map.getSize();
        if (point.x < 0 || point.x > size['width'] || point.y < 0 || point.y > size['height']) {
            return false;
        }
        try {
            const imgData = this.context.getImageData(point.x, point.y, 1, 1).data;
            if (imgData[3] > 0) {
                return true;
            }
        } catch (error) {
            if (!this._errorThrown) {
                if (console) {
                    console.warn('hit detect failed with tainted canvas, some geometries have external resources in another domain:\n', error);
                }
                this._errorThrown = true;
            }
            //usually a CORS error will be thrown if the canvas uses resources from other domain.
            //this may happen when a geometry is filled with pattern file.
            return false;
        }
        return false;

    }

    /**
     * loadResource from resourceUrls
     * @param  {String[]} resourceUrls    - Array of urls to load
     * @param  {Function} onComplete          - callback after loading complete
     * @param  {Object} context         - callback's context
     * @returns {Promise[]}
     */
    loadResources(resourceUrls) {
        if (!this.resources) {
            /* eslint-disable no-use-before-define */
            this.resources = new ResourceCache();
            /* eslint-enable no-use-before-define */
        }
        const resources = this.resources,
            promises = [];
        if (isArrayHasData(resourceUrls)) {
            const cache = {};
            for (let i = resourceUrls.length - 1; i >= 0; i--) {
                const url = resourceUrls[i];
                if (!url || !url.length || cache[url.join('-')]) {
                    continue;
                }
                cache[url.join('-')] = 1;
                if (!resources.isResourceLoaded(url, true)) {
                    //closure it to preserve url's value
                    promises.push(new Promise(this._promiseResource(url)));
                }
            }
        }
        return Promise.all(promises);
    }

    /**
     * Prepare rendering
     * Set necessary properties, like this._renderZoom/ this._extent2D, this._northWest
     * @private
     */
    prepareRender() {
        delete this._renderComplete;
        const map = this.getMap();
        this._renderZoom = map.getZoom();
        this._extent2D = map._get2DExtent();
        this._northWest = map._containerPointToPoint(new Point(0, 0));
    }

    /**
     * Create renderer's Canvas
     */
    createCanvas() {
        if (this.canvas) {
            return;
        }
        const map = this.getMap();
        const size = map.getSize();
        const r = Browser.retina ? 2 : 1;
        this.canvas = Canvas2D.createCanvas(r * size['width'], r * size['height'], map.CanvasClass);
        this.context = this.canvas.getContext('2d');
        if (this.layer.options['globalCompositeOperation']) {
            this.context.globalCompositeOperation = this.layer.options['globalCompositeOperation'];
        }
        if (Browser.retina) {
            this.context.scale(r, r);
        }
        if (this.onCanvasCreate) {
            this.onCanvasCreate();
        }
    }

    /**
     * Resize the canvas
     * @param  {Size} canvasSize the size resizing to
     */
    resizeCanvas(canvasSize) {
        if (!this.canvas) {
            return;
        }
        let size;
        if (!canvasSize) {
            const map = this.getMap();
            size = map.getSize();
        } else {
            size = canvasSize;
        }
        const r = Browser.retina ? 2 : 1;
        if (this.canvas.width === r * size['width'] && this.canvas.height === r * size['height']) {
            return;
        }
        //retina support
        this.canvas.height = r * size['height'];
        this.canvas.width = r * size['width'];
        if (Browser.retina) {
            this.context.scale(r, r);
        }
    }

    /**
     * Clear the canvas to blank
     */
    clearCanvas() {
        if (!this.canvas) {
            return;
        }
        Canvas2D.clearRect(this.context, 0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Prepare the canvas for rendering. <br>
     * 1. Clear the canvas to blank. <br>
     * 2. Clip the canvas by mask if there is any and return the mask's extent
     * @return {PointExtent} mask's extent of current zoom's 2d point.
     */
    prepareCanvas() {
        if (this._clipped) {
            this.context.restore();
            this._clipped = false;
        }
        if (!this.canvas) {
            this.createCanvas();
        } else {
            this.clearCanvas();
        }
        delete this._maskExtent;
        const mask = this.layer.getMask();
        if (!mask) {
            this.layer.fire('renderstart', {
                'context': this.context
            });
            return null;
        }
        const maskExtent2D = this._maskExtent = mask._getPainter().get2DExtent();
        if (!maskExtent2D.intersects(this._extent2D)) {
            this.layer.fire('renderstart', {
                'context': this.context
            });
            return maskExtent2D;
        }
        this.context.save();
        mask._paint();
        this.context.clip();
        this._clipped = true;
        /**
         * renderstart event, fired when layer starts to render.
         *
         * @event Layer#renderstart
         * @type {Object}
         * @property {String} type              - renderstart
         * @property {Layer} target    - layer
         * @property {CanvasRenderingContext2D} context - canvas's context
         */
        this.layer.fire('renderstart', {
            'context': this.context
        });
        return maskExtent2D;
    }

     /**
     * Get renderer's current view extent in 2d point
     * @return {Object} view.extent, view.maskExtent, view.zoom, view.northWest
     */
    getViewExtent() {
        return {
            'extent' : this._extent2D,
            'maskExtent' : this._maskExtent,
            'zoom' : this._renderZoom,
            'northWest' : this._northWest
        };
    }

    /**
     * call when rendering completes, this will fire necessary events and call setCanvasUpdated
     */
    completeRender() {
        if (this.getMap() && this.context) {
            this._renderComplete = true;
            /**
             * renderend event, fired when layer ends rendering.
             *
             * @event Layer#renderend
             * @type {Object}
             * @property {String} type              - renderend
             * @property {Layer} target    - layer
             * @property {CanvasRenderingContext2D} context - canvas's context
             */
            this.layer.fire('renderend', {
                'context': this.context
            });
            this.setCanvasUpdated();
        }
    }

    /**
     * Get renderer's event map registered on the map
     * @return {Object} events
     */
    getEvents() {
        return {
            '_zoomstart' : this.onZoomStart,
            '_zooming' : this.onZooming,
            '_zoomend' : this.onZoomEnd,
            '_resize'  : this.onResize,
            '_movestart' : this.onMoveStart,
            '_moving' : this.onMoving,
            '_moveend' : this.onMoveEnd,
            '_dragrotatestart' : this.onDragRotateStart,
            '_dragrotating' : this.onDragRotating,
            '_dragrotateend' : this.onDragRotateEnd,
            '_spatialreferencechange' : this.onSpatialReferenceChange
        };
    }

    /**
    /**
     * onZoomStart
     * @param  {Object} param event parameters
     */
    onZoomStart() {
    }

    /**
    * onZoomEnd
    * @param  {Object} param event parameters
    */
    onZoomEnd() {
        this.setToRedraw();
    }

    /**
    * onZooming
    * @param  {Object} param event parameters
    */
    onZooming() {}

    /**
    * onMoveStart
    * @param  {Object} param event parameters
    */
    onMoveStart() {}

    /**
    * onMoving
    * @param  {Object} param event parameters
    */
    onMoving() {}

    /**
    * onMoveEnd
    * @param  {Object} param event parameters
    */
    onMoveEnd() {
        this.setToRedraw();
    }

    /**
    * onResize
    * @param  {Object} param event parameters
    */
    onResize() {
        delete this._extent2D;
        this.resizeCanvas();
        this.setToRedraw();
    }

    /**
    * onDragRotateStart
    * @param  {Object} param event parameters
    */
    onDragRotateStart() {}

    /**
    * onDragRotating
    * @param  {Object} param event parameters
    */
    onDragRotating() {}

    /**
    * onDragRotateEnd
    * @param  {Object} param event parameters
    */
    onDragRotateEnd() {
        this.setToRedraw();
    }

    /**
    * onSpatialReferenceChange
    * @param  {Object} param event parameters
    */
    onSpatialReferenceChange() {
    }

    /**
     * Get ellapsed time of previous drawing
     * @return {Number}
     */
    getDrawTime() {
        return this._drawTime;
    }

    _tryToDraw() {
        this._toRedraw = false;
        if (!this.canvas && this.layer.isEmpty && this.layer.isEmpty()) {
            this._renderComplete = true;
            // not to create canvas when layer is empty
            return;
        }
        if (!this._painted && this.onAdd) {
            this.onAdd();
        }
        this._drawAndRecord();
    }

    _drawAndRecord() {
        if (!this.getMap()) {
            return;
        }
        this._painted = true;
        const t = now();
        this.draw();
        this._drawTime = now() - t;
    }

    _promiseResource(url) {
        const me = this, resources = this.resources,
            crossOrigin = this.layer.options['crossOrigin'];
        return function (resolve) {
            if (resources.isResourceLoaded(url, true)) {
                resolve(url);
                return;
            }
            const img = new Image();
            if (crossOrigin) {
                img['crossOrigin'] = crossOrigin;
            }
            if (isSVG(url[0]) && !IS_NODE) {
                //amplify the svg image to reduce loading.
                if (url[1]) { url[1] *= 2; }
                if (url[2]) { url[2] *= 2; }
            }
            img.onload = function () {
                me._cacheResource(url, img);
                resolve(url);
            };
            img.onabort = function (err) {
                if (console) { console.warn('image loading aborted: ' + url[0]); }
                if (err) {
                    if (console) { console.warn(err); }
                }
                resolve(url);
            };
            img.onerror = function (err) {
                // if (console) { console.warn('image loading failed: ' + url[0]); }
                if (err && typeof console !== 'undefined') {
                    console.warn(err);
                }
                resources.markErrorResource(url);
                resolve(url);
            };
            loadImage(img,  url);
        };

    }

    _cacheResource(url, img) {
        if (!this.layer || !this.resources) {
            return;
        }
        let w = url[1], h = url[2];
        if (this.layer.options['cacheSvgOnCanvas'] && isSVG(url[0]) === 1 && (Browser.edge || Browser.ie)) {
            //opacity of svg img painted on canvas is always 1, so we paint svg on a canvas at first.
            if (isNil(w)) {
                w = img.width || this.layer.options['defaultIconSize'][0];
            }
            if (isNil(h)) {
                h = img.height || this.layer.options['defaultIconSize'][1];
            }
            const canvas = Canvas2D.createCanvas(w, h);
            Canvas2D.image(canvas.getContext('2d'), img, 0, 0, w, h);
            img = canvas;
        }
        this.resources.addResource(url, img);
    }
}

export default CanvasRenderer;

export class ResourceCache {
    constructor() {
        this.resources = {};
        this._errors = {};
    }

    addResource(url, img) {
        this.resources[url[0]] = {
            image: img,
            width: +url[1],
            height: +url[2]
        };
    }

    isResourceLoaded(url, checkSVG) {
        if (!url) {
            return false;
        }
        const imgUrl = this._getImgUrl(url);
        if (this._errors[imgUrl]) {
            return true;
        }
        const img = this.resources[imgUrl];
        if (!img) {
            return false;
        }
        if (checkSVG && isSVG(url[0]) && (+url[1] > img.width || +url[2] > img.height)) {
            return false;
        }
        return true;
    }

    getImage(url) {
        const imgUrl = this._getImgUrl(url);
        if (!this.isResourceLoaded(url) || this._errors[imgUrl]) {
            return null;
        }
        return this.resources[imgUrl].image;
    }

    markErrorResource(url) {
        this._errors[this._getImgUrl(url)] = 1;
    }

    merge(res) {
        if (!res) {
            return this;
        }
        for (const p in res.resources) {
            const img = res.resources[p];
            this.addResource([p, img.width, img.height], img.image);
        }
        return this;
    }

    _getImgUrl(url) {
        if (!Array.isArray(url)) {
            return url;
        }
        return url[0];
    }
}
