(function(global) {
    'use strict';

    var util = newUtil();
    var inliner = newInliner();
    var fontFaces = newFontFaces();
    var images = newImages();

    // Default impl options
    var defaultOptions = {
        // Default is to fail on error, no placeholder
        imagePlaceholder: undefined,
        // Default cache bust is false, it will use the cache
        cacheBust: false,
        // Use (existing) authentication credentials for external URIs (CORS requests)
        useCredentials: false
    };

    var domtoimage = {
        toSvg: toSvg,
        toPng: toPng,
        toJpeg: toJpeg,
        toBlob: toBlob,
        toPixelData: toPixelData,
        toCanvas: toCanvas,
        impl: {
            fontFaces: fontFaces,
            images: images,
            util: util,
            inliner: inliner,
            options: {}
        }
    };

    if (typeof exports === "object" && typeof module === "object")
        module.exports = domtoimage;
    else
        global.domtoimage = domtoimage;

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options
     * @param {Function} options.filter - Should return true if passed node should be included in the output
     *          (excluding node means excluding it's children as well). Not called on the root node.
     * @param {String} options.bgcolor - color for the background, any valid CSS color value.
     * @param {Number} options.width - width to be applied to node before rendering.
     * @param {Number} options.height - height to be applied to node before rendering.
     * @param {Object} options.style - an object whose properties to be copied to node's style before rendering.
     * @param {Number} options.quality - a Number between 0 and 1 indicating image quality (applicable to JPEG only),
                defaults to 1.0.
     * @param {Number} options.scale - a Number multiplier to scale up the canvas before rendering to reduce fuzzy images, defaults to 1.0.
     * @param {String} options.imagePlaceholder - dataURL to use as a placeholder for failed images, default behaviour is to fail fast on images we can't fetch
     * @param {Boolean} options.cacheBust - set to true to cache bust by appending the time to the request url
     * @return {Promise} - A promise that is fulfilled with a SVG image data URL
     * */
    function toSvg(node, options) {
        options = options || {};
        copyOptions(options);
        return Promise.resolve(node)
            .then(function(node) {
                return cloneNode(node, options.filter, true);
            })
            .then(embedFonts)
            .then(inlineImages)
            .then(applyOptions)
            .then(function(clone) {
                return makeSvgDataUri(clone,
                    options.width || util.width(node),
                    options.height || util.height(node)
                );
            });

        function applyOptions(clone) {
            if (options.bgcolor) clone.style.backgroundColor = options.bgcolor;
            if (options.width) clone.style.width = options.width + 'px';
            if (options.height) clone.style.height = options.height + 'px';

            if (options.style)
                Object.keys(options.style).forEach(function(property) {
                    clone.style[property] = options.style[property];
                });

            return clone;
        }
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a Uint8Array containing RGBA pixel data.
     * */
    function toPixelData(node, options) {
        return draw(node, options || {})
            .then(function(canvas) {
                return canvas.getContext('2d').getImageData(
                    0,
                    0,
                    util.width(node),
                    util.height(node)
                ).data;
            });
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a PNG image data URL
     * */
    function toPng(node, options) {
        return draw(node, options || {})
            .then(function(canvas) {
                return canvas.toDataURL();
            });
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a JPEG image data URL
     * */
    function toJpeg(node, options) {
        options = options || {};
        return draw(node, options)
            .then(function(canvas) {
                return canvas.toDataURL('image/jpeg', options.quality || 1.0);
            });
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a PNG image blob
     * */
    function toBlob(node, options) {
        return draw(node, options || {})
            .then(util.canvasToBlob);
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a canvas object
     * */
    function toCanvas(node, options) {
        return draw(node, options || {});
    }

    function copyOptions(options) {
        // Copy options to impl options for use in impl
        if (typeof(options.imagePlaceholder) === 'undefined') {
            domtoimage.impl.options.imagePlaceholder = defaultOptions.imagePlaceholder;
        } else {
            domtoimage.impl.options.imagePlaceholder = options.imagePlaceholder;
        }

        if (typeof(options.cacheBust) === 'undefined') {
            domtoimage.impl.options.cacheBust = defaultOptions.cacheBust;
        } else {
            domtoimage.impl.options.cacheBust = options.cacheBust;
        }

        if(typeof(options.useCredentials) === 'undefined') {
            domtoimage.impl.options.useCredentials = defaultOptions.useCredentials;
        } else {
            domtoimage.impl.options.useCredentials = options.useCredentials;
        }
    }

    function draw(domNode, options) {
        return toSvg(domNode, options)
            .then(util.makeImage)
            .then(util.delay(100))
            .then(function(image) {
                var scale = typeof(options.scale) !== 'number' ? 1 : options.scale;
                var canvas = newCanvas(domNode, scale);
                var ctx = canvas.getContext('2d');
                if (image) {
                    ctx.scale(scale, scale);
                    ctx.drawImage(image, 0, 0);
                }
                return canvas;
            });

        function newCanvas(domNode, scale) {
            var canvas = document.createElement('canvas');
            canvas.width = (options.width || util.width(domNode)) * scale;
            canvas.height = (options.height || util.height(domNode)) * scale;

            if (options.bgcolor) {
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = options.bgcolor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            return canvas;
        }
    }

    function cloneNode(node, filter, root) {
        if (!root && filter && !filter(node)) return Promise.resolve();

        return Promise.resolve(node)
            .then(makeNodeCopy)
            .then(function(clone) {
                return cloneChildren(node, clone, filter);
            })
            .then(function(clone) {
                return processClone(node, clone);
            });

        function makeNodeCopy(node) {
            if (node instanceof HTMLCanvasElement) return util.makeImage(node.toDataURL());
            return node.cloneNode(false);
        }

        function cloneChildren(original, clone, filter) {
            var children = original.childNodes;
            if (children.length === 0) return Promise.resolve(clone);

            return cloneChildrenInOrder(clone, util.asArray(children), filter)
                .then(function() {
                    return clone;
                });

            function cloneChildrenInOrder(parent, children, filter) {
                var done = Promise.resolve();
                children.forEach(function(child) {
                    done = done
                        .then(function() {
                            return cloneNode(child, filter);
                        })
                        .then(function(childClone) {
                            if (childClone) parent.appendChild(childClone);
                        });
                });
                return done;
            }
        }

        function processClone(original, clone) {
            if (!(clone instanceof Element)) return clone;

            return Promise.resolve()
                .then(cloneStyle)
                .then(clonePseudoElements)
                .then(copyUserInput)
                .then(fixSvg)
                .then(function() {
                    return clone;
                });

            function cloneStyle() {
                let source, target;
                copyStyle(window.getComputedStyle(original), clone.style);

                function copyStyle(source, target) {
                    target.fontStretch == '';
                    if (source.cssText) {
                        target.cssText = source.cssText;
                          target.font = source.font; // here, we re-assign the font prop.
                    } else copyProperties(source, target);
                    target.fontStretch = 'normal';

                    function copyProperties(source, target) {
                        util.asArray(source).forEach(function(name) {
                            target.setProperty(
                                name,
                                source.getPropertyValue(name),
                                source.getPropertyPriority(name)
                            );
                        });
                    }
                }
            }

            function clonePseudoElements() {
                [':before', ':after'].forEach(function(element) {
                    clonePseudoElement(element);
                });

                function clonePseudoElement(element) {
                    var style = window.getComputedStyle(original, element);
                    var content = style.getPropertyValue('content');

                    if (content === '' || content === 'none') return;

                    var className = util.uid();
                    var currentClass = clone.getAttribute('class');
                    if (currentClass) {
                        clone.setAttribute('class', currentClass + ' ' + className);
                    }

                    var styleElement = document.createElement('style');
                    styleElement.appendChild(formatPseudoElementStyle(className, element, style));
                    clone.appendChild(styleElement);

                    function formatPseudoElementStyle(className, element, style) {
                        var selector = '.' + className + ':' + element;
                        var cssText = style.cssText ? formatCssText(style) : formatCssProperties(style);
                        return document.createTextNode(selector + '{' + cssText + '}');

                        function formatCssText(style) {
                            var content = style.getPropertyValue('content');
                            return style.cssText + ' content: ' + content + ';';
                        }

                        function formatCssProperties(style) {

                            return util.asArray(style)
                                .map(formatProperty)
                                .join('; ') + ';';

                            function formatProperty(name) {
                                return name + ': ' +
                                    style.getPropertyValue(name) +
                                    (style.getPropertyPriority(name) ? ' !important' : '');
                            }
                        }
                    }
                }
            }

            function copyUserInput() {
                if (original instanceof HTMLTextAreaElement) clone.innerHTML = original.value;
                if (original instanceof HTMLInputElement) clone.setAttribute("value", original.value);
            }

            function fixSvg() {
                if (!(clone instanceof SVGElement)) return;
                clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

                if (!(clone instanceof SVGRectElement)) return;
                ['width', 'height'].forEach(function(attribute) {
                    var value = clone.getAttribute(attribute);
                    if (!value) return;

                    clone.style.setProperty(attribute, value);
                });
            }
        }
    }

    function embedFonts(node) {
        return fontFaces.resolveAll()
            .then(function(cssText) {
                var styleNode = document.createElement('style');
                node.appendChild(styleNode);
                styleNode.appendChild(document.createTextNode(cssText));
                return node;
            });
    }

    function inlineImages(node) {
        return images.inlineAll(node)
            .then(function() {
                return node;
            });
    }

    function makeSvgDataUri(node, width, height) {
        return Promise.resolve(node)
            .then(function(node) {
                node.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
                return new XMLSerializer().serializeToString(node);
            })
            .then(util.escapeXhtml)
            .then(function(xhtml) {
                return '<foreignObject x="0" y="0" width="100%" height="100%"><style type="text/css"><![CDATA[ @font-face { font-family: "aahub"; src: url(data:application/font-woff2;charset=utf-8;base64,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) format("woff2"); font-display: swap; } ]]></style>' + xhtml + '</foreignObject>';
            })
            .then(function(foreignObject) {
                return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><style type="text/css"><![CDATA[ @font-face { font-family: "aahub"; src: url(data:application/font-woff2;charset=utf-8;base64,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) format("woff2"); font-display: swap; } ]]></style>' +
                    foreignObject + '</svg>';
            })
            .then(function(svg) {
                return 'data:image/svg+xml;charset=utf-8,' + svg;
            });
    }

    function newUtil() {
        return {
            escape: escape,
            parseExtension: parseExtension,
            mimeType: mimeType,
            dataAsUrl: dataAsUrl,
            isDataUrl: isDataUrl,
            canvasToBlob: canvasToBlob,
            resolveUrl: resolveUrl,
            getAndEncode: getAndEncode,
            uid: uid(),
            delay: delay,
            asArray: asArray,
            escapeXhtml: escapeXhtml,
            makeImage: makeImage,
            width: width,
            height: height
        };

        function mimes() {
            /*
             * Only WOFF and EOT mime types for fonts are 'real'
             * see http://www.iana.org/assignments/media-types/media-types.xhtml
             */
            var WOFF = 'application/font-woff';
            var JPEG = 'image/jpeg';

            return {
                'woff': WOFF,
                'woff2': WOFF,
                'ttf': 'application/font-truetype',
                'eot': 'application/vnd.ms-fontobject',
                'png': 'image/png',
                'jpg': JPEG,
                'jpeg': JPEG,
                'gif': 'image/gif',
                'tiff': 'image/tiff',
                'svg': 'image/svg+xml'
            };
        }

        function parseExtension(url) {
            var match = /\.([^\.\/]*?)(\?|$)/g.exec(url);
            if (match) return match[1];
            else return '';
        }

        function mimeType(url) {
            var extension = parseExtension(url).toLowerCase();
            return mimes()[extension] || '';
        }

        function isDataUrl(url) {
            return url.search(/^(data:)/) !== -1;
        }

        function toBlob(canvas) {
            return new Promise(function(resolve) {
                var binaryString = window.atob(canvas.toDataURL().split(',')[1]);
                var length = binaryString.length;
                var binaryArray = new Uint8Array(length);

                for (var i = 0; i < length; i++)
                    binaryArray[i] = binaryString.charCodeAt(i);

                resolve(new Blob([binaryArray], {
                    type: 'image/png'
                }));
            });
        }

        function canvasToBlob(canvas) {
            if (canvas.toBlob)
                return new Promise(function(resolve) {
                    canvas.toBlob(resolve);
                });

            return toBlob(canvas);
        }

        function resolveUrl(url, baseUrl) {
            var doc = document.implementation.createHTMLDocument();
            var base = doc.createElement('base');
            doc.head.appendChild(base);
            var a = doc.createElement('a');
            doc.body.appendChild(a);
            base.href = baseUrl;
            a.href = url;
            return a.href;
        }

        function uid() {
            var index = 0;

            return function() {
                return 'u' + fourRandomChars() + index++;

                function fourRandomChars() {
                    /* see http://stackoverflow.com/a/6248722/2519373 */
                    return ('0000' + (Math.random() * Math.pow(36, 4) << 0).toString(36)).slice(-4);
                }
            };
        }

        function makeImage(uri) {
            if (uri === 'data:,') return Promise.resolve();
            return new Promise(function(resolve, reject) {
                var image = new Image();
                if(domtoimage.impl.options.useCredentials) {
                    image.crossOrigin = 'use-credentials';
                }
                image.onload = function() {
                    resolve(image);
                };
                image.onerror = reject;
                image.src = uri;
            });
        }

        function getAndEncode(url) {
            var TIMEOUT = 30000;
            if (domtoimage.impl.options.cacheBust) {
                // Cache bypass so we dont have CORS issues with cached images
                // Source: https://developer.mozilla.org/en/docs/Web/API/XMLHttpRequest/Using_XMLHttpRequest#Bypassing_the_cache
                url += ((/\?/).test(url) ? "&" : "?") + (new Date()).getTime();
            }

            return new Promise(function(resolve) {
                var request = new XMLHttpRequest();

                request.onreadystatechange = done;
                request.ontimeout = timeout;
                request.responseType = 'blob';
                request.timeout = TIMEOUT;
                if(domtoimage.impl.options.useCredentials) {
                    request.withCredentials = true;
                }
                request.open('GET', url, true);
                request.send();

                var placeholder;
                if (domtoimage.impl.options.imagePlaceholder) {
                    var split = domtoimage.impl.options.imagePlaceholder.split(/,/);
                    if (split && split[1]) {
                        placeholder = split[1];
                    }
                }

                function done() {
                    if (request.readyState !== 4) return;

                    if (request.status !== 200) {
                        if (placeholder) {
                            resolve(placeholder);
                        } else {
                            fail('cannot fetch resource: ' + url + ', status: ' + request.status);
                        }

                        return;
                    }

                    var encoder = new FileReader();
                    encoder.onloadend = function() {
                        var content = encoder.result.split(/,/)[1];
                        resolve(content);
                    };
                    encoder.readAsDataURL(request.response);
                }

                function timeout() {
                    if (placeholder) {
                        resolve(placeholder);
                    } else {
                        fail('timeout of ' + TIMEOUT + 'ms occured while fetching resource: ' + url);
                    }
                }

                function fail(message) {
                    console.error(message);
                    resolve('');
                }
            });
        }

        function dataAsUrl(content, type) {
            return 'data:' + type + ';base64,' + content;
        }

        function escape(string) {
            return string.replace(/([.*+?^${}()|\[\]\/\\])/g, '\\$1');
        }

        function delay(ms) {
            return function(arg) {
                return new Promise(function(resolve) {
                    setTimeout(function() {
                        resolve(arg);
                    }, ms);
                });
            };
        }

        function asArray(arrayLike) {
            var array = [];
            var length = arrayLike.length;
            for (var i = 0; i < length; i++) array.push(arrayLike[i]);
            return array;
        }

        function escapeXhtml(string) {
            return string.replace(/#/g, '%23').replace(/\n/g, '%0A');
        }

        function width(node) {
            var leftBorder = px(node, 'border-left-width');
            var rightBorder = px(node, 'border-right-width');
            return node.scrollWidth + leftBorder + rightBorder;
        }

        function height(node) {
            var topBorder = px(node, 'border-top-width');
            var bottomBorder = px(node, 'border-bottom-width');
            return node.scrollHeight + topBorder + bottomBorder;
        }

        function px(node, styleProperty) {
            var value = window.getComputedStyle(node).getPropertyValue(styleProperty);
            return parseFloat(value.replace('px', ''));
        }
    }

    function newInliner() {
        var URL_REGEX = /url\(['"]?([^'"]+?)['"]?\)/g;

        return {
            inlineAll: inlineAll,
            shouldProcess: shouldProcess,
            impl: {
                readUrls: readUrls,
                inline: inline
            }
        };

        function shouldProcess(string) {
            return string.search(URL_REGEX) !== -1;
        }

        function readUrls(string) {
            var result = [];
            var match;
            while ((match = URL_REGEX.exec(string)) !== null) {
                result.push(match[1]);
            }
            return result.filter(function(url) {
                return !util.isDataUrl(url);
            });
        }

        function inline(string, url, baseUrl, get) {
            return Promise.resolve(url)
                .then(function(url) {
                    return baseUrl ? util.resolveUrl(url, baseUrl) : url;
                })
                .then(get || util.getAndEncode)
                .then(function(data) {
                    return util.dataAsUrl(data, util.mimeType(url));
                })
                .then(function(dataUrl) {
                    return string.replace(urlAsRegex(url), '$1' + dataUrl + '$3');
                });

            function urlAsRegex(url) {
                return new RegExp('(url\\([\'"]?)(' + util.escape(url) + ')([\'"]?\\))', 'g');
            }
        }

        function inlineAll(string, baseUrl, get) {
            if (nothingToInline()) return Promise.resolve(string);

            return Promise.resolve(string)
                .then(readUrls)
                .then(function(urls) {
                    var done = Promise.resolve(string);
                    urls.forEach(function(url) {
                        done = done.then(function(string) {
                            return inline(string, url, baseUrl, get);
                        });
                    });
                    return done;
                });

            function nothingToInline() {
                return !shouldProcess(string);
            }
        }
    }

    function newFontFaces() {
        return {
            resolveAll: resolveAll,
            impl: {
                readAll: readAll
            }
        };

        function resolveAll() {
            return readAll(document)
                .then(function(webFonts) {
                    return Promise.all(
                        webFonts.map(function(webFont) {
                            return webFont.resolve();
                        })
                    );
                })
                .then(function(cssStrings) {
                    return cssStrings.join('\n');
                });
        }

        function readAll() {
            return Promise.resolve(util.asArray(document.styleSheets))
                .then(getCssRules)
                .then(selectWebFontRules)
                .then(function(rules) {
                    return rules.map(newWebFont);
                });

            function selectWebFontRules(cssRules) {
                return cssRules
                    .filter(function(rule) {
                        return rule.type === CSSRule.FONT_FACE_RULE;
                    })
                    .filter(function(rule) {
                        return inliner.shouldProcess(rule.style.getPropertyValue('src'));
                    });
            }

            function getCssRules(styleSheets) {
                var cssRules = [];
                styleSheets.forEach(function(sheet) {
                    if (sheet.hasOwnProperty("cssRules")) {
                        try {
                            util.asArray(sheet.cssRules || []).forEach(cssRules.push.bind(cssRules));
                        } catch (e) {
                            console.log('Error while reading CSS rules from ' + sheet.href, e.toString());
                        }
                    }
                });
                return cssRules;
            }

            function newWebFont(webFontRule) {
                return {
                    resolve: function resolve() {
                        var baseUrl = (webFontRule.parentStyleSheet || {}).href;
                        return inliner.inlineAll(webFontRule.cssText, baseUrl);
                    },
                    src: function() {
                        return webFontRule.style.getPropertyValue('src');
                    }
                };
            }
        }
    }

    function newImages() {
        return {
            inlineAll: inlineAll,
            impl: {
                newImage: newImage
            }
        };

        function newImage(element) {
            return {
                inline: inline
            };

            function inline(get) {
                if (util.isDataUrl(element.src)) return Promise.resolve();

                return Promise.resolve(element.src)
                    .then(get || util.getAndEncode)
                    .then(function(data) {
                        return util.dataAsUrl(data, util.mimeType(element.src));
                    })
                    .then(function(dataUrl) {
                        return new Promise(function(resolve, reject) {
                            element.onload = resolve;
                            // for any image with invalid src(such as <img src />), just ignore it
                            element.onerror = resolve;
                            element.src = dataUrl;
                        });
                    });
            }
        }

        function inlineAll(node) {
            if (!(node instanceof Element)) return Promise.resolve(node);

            return inlineBackground(node)
                .then(function() {
                    if (node instanceof HTMLImageElement)
                        return newImage(node).inline();
                    else
                        return Promise.all(
                            util.asArray(node.childNodes).map(function(child) {
                                return inlineAll(child);
                            })
                        );
                });

            function inlineBackground(node) {
                var background = node.style.getPropertyValue('background');

                if (!background) return Promise.resolve(node);

                return inliner.inlineAll(background)
                    .then(function(inlined) {
                        node.style.setProperty(
                            'background',
                            inlined,
                            node.style.getPropertyPriority('background')
                        );
                    })
                    .then(function() {
                        return node;
                    });
            }
        }
    }
})(this);
