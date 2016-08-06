var UPDATE_INTERVAL_MS = 250;
var MAX_SEEN = 60;
var MIN_ALTITUDE = 0;
var MAX_ALTITUDE = 40000;
var MIN_OPACITY = 0.25;

function setMapSize() {
    $('#map').css({
        position: 'absolute',
        width: $(window).width(),
        height: ($(window).height()-100)
    });
}

$(window).resize(function() {
    setMapSize();
});

setMapSize();

var layer = ga.layer.create('ch.bazl.luftfahrtkarten-icao');
layer.setOpacity(0.25);
var map = new ga.Map({
    interactions: ol.interaction.defaults({
        mouseWheelZoom: false,
        // dragPan: false
    }),
    tooltip: false,
    target: 'map',
    layers: [layer],
    view: new ol.View({
        resolution: 100,
        center: [690000, 230000]
    })
});

// map.addControl(new ol.control.FullScreen());

function getTrackStyle(altitude) {
    if (altitude < MIN_ALTITUDE) {
        altitude = MIN_ALTITUDE;
    }
    else if (altitude > MAX_ALTITUDE) {
        altitude = MAX_ALTITUDE;
    }

    var n = altitude*240/(MAX_ALTITUDE-MIN_ALTITUDE);

    var trackColor = 'hsl('+n+',100%,50%)';
    return new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: trackColor,
            width: 2
        })
    });
}

function getTrackPointStyle(altitude) {
    if (altitude < MIN_ALTITUDE) {
        altitude = MIN_ALTITUDE;
    }
    else if (altitude > MAX_ALTITUDE) {
        altitude = MAX_ALTITUDE;
    }

    var n = altitude*240/(MAX_ALTITUDE-MIN_ALTITUDE);

    var trackColor = 'hsl('+n+',100%,50%)';
    return new ol.style.Style({
        image: new ol.style.Circle({
            radius: 1,
            fill: new ol.style.Fill({
                color: trackColor
            }),
            stroke: new ol.style.Stroke({
                color: trackColor,
                width: 0
            })
        })
    });
}

function toRad(angle) {
    return angle*Math.PI/180;
}

function getPlaneStyle(plane, highlighted = false) {
    var font = '11px Menlo,Courier,monospace';
    var seen = plane.get('seen');
    var opacity = (seen > MAX_SEEN) ? MIN_OPACITY : (1-seen/MAX_SEEN*(1-MIN_OPACITY));

    var planeCall = plane.get('flight');
    if (planeCall == '') {
        planeCall = '['+plane.get('hex').toUpperCase()+']';
    }

    var r = 0;
    var g = 0;
    var b = 0;

    var planeSquawk = plane.get('squawk');
    switch (planeSquawk) {
        case '7100':
            r = 255;
            planeSquawk += ' REGA';
            font = 'bold '+font;
            break;
        case '7500':
            r = 255;
            planeSquawk += ' HIJACKING';
            font = 'bold '+font;
            break;
        case '7600':
            r = 255;
            planeSquawk += ' RADIO FAILURE';
            font = 'bold '+font;
            break;
        case '7700':
            r = 255;
            planeSquawk += ' EMERGENCY';
            font = 'bold '+font;
            break;
    }

    var vertIndicator = ' ';
    var vertRate = plane.get('vert_rate');
    if (vertRate < 0) {
        vertIndicator = '\u2193';
    }
    else if (vertRate > 0) {
        vertIndicator = '\u2191';
    }
    var altitude = Math.round(plane.get('altitude')/100)+"";
    if (altitude.length == 1) {
        altitude = '00'+altitude;
    }
    else if (altitude.length == 2) {
        altitude = '0'+altitude;
    }
    var planeInfo = altitude+vertIndicator+Math.round(plane.get('speed')/10);

    if (highlighted && (r == 0)) {
        b = 255;
    }

    var fillColor = [r, g, b, opacity];
    var strokeColor = [r, g, b, opacity];
    var textColor = [r, g, b, opacity];

    // speed vector unit is meters per 10 seconds, i.e. where the plane is in 10 seconds
    var speed = plane.get('speed')*0.514444*10;
    var track = plane.get('track');
    var pointFrom = plane.getGeometry().getCoordinates();
    var pointTo = [
        pointFrom[0] + speed*Math.sin(toRad(track)),
        pointFrom[1] + speed*Math.cos(toRad(track))
    ];
    var line = new ol.geom.LineString([
        pointTo,
        pointFrom
    ]);

    return [
        new ol.style.Style({
            geometry: line,
            stroke: new ol.style.Stroke({
                color: strokeColor,
                width: 2
            })
        }),
        new ol.style.Style({
            image: new ol.style.Circle({
                radius: 5,
                /*
                fill: new ol.style.Fill({
                    color: fillColor
                }),
                */
                stroke: new ol.style.Stroke({
                    color: strokeColor,
                    width: 2
                })
            })
        }),
        new ol.style.Style({
            text: new ol.style.Text({
                font: font,
                text: planeCall, 
                textAlign: 'left',
                offsetX: 10,
                offsetY: -11,
                rotation: 0,
                fill: new ol.style.Fill({
                    color: textColor
                }),
            })
        }),
        new ol.style.Style({
            text: new ol.style.Text({
                font: font,
                text: planeSquawk, 
                textAlign: 'left',
                offsetX: 10,
                offsetY: 0,
                rotation: 0,
                fill: new ol.style.Fill({
                    color: textColor
                }),
            })
        }),
        new ol.style.Style({
            text: new ol.style.Text({
                font: font,
                text: planeInfo, 
                textAlign: 'left',
                offsetX: 10,
                offsetY: 11,
                rotation: 0,
                fill: new ol.style.Fill({
                    color: textColor
                }),
            })
        })
    ];
}

(function worker() {
    fetchUpdatePlaneLayer();
    setTimeout(worker, UPDATE_INTERVAL_MS);
})();

var planeLayer = new ol.layer.Vector({
    source: new ol.source.Vector()
});

var planeTrackLayer = new ol.layer.Vector({
    source: new ol.source.Vector()
});

map.addLayer(planeTrackLayer);
map.addLayer(planeLayer);

function fetchUpdatePlaneLayer() {
    $.getJSON('/data.json', function(data) {
        
        planeLayer.getSource().getFeatures().forEach(function (feature, index, array) {
            feature.set('dirty', true);
        });

        $.each(data, function () {
            if ((this.validposition == 0) || (this.validtrack == 0) || (this.seen > MAX_SEEN)) {
                return true;
            }

            var coordinates = ol.proj.transform([this.lon, this.lat], 'EPSG:4326', 'EPSG:21781');

            var plane = planeLayer.getSource().getFeatureById(this.hex);

            if (plane) {
                // console.log('Updating plane '+this.flight+' '+this.altitude);

                var oldCoordinates = plane.getGeometry().getCoordinates();
                plane.setGeometry(new ol.geom.Point(coordinates));

                if ((oldCoordinates[0] != coordinates[0]) || (oldCoordinates[1] != coordinates[1])) {
                    // console.log('Updating track');

                    var line = new ol.geom.LineString([oldCoordinates, coordinates]);
                    var track = new ol.Feature({
                        geometry: line,
                        name: this.hex
                    });

                    track.setStyle(getTrackStyle(this.altitude));
                    planeTrackLayer.getSource().addFeature(track);

                    var trackPoint = new ol.Feature({
                        geometry: new ol.geom.Point(coordinates),
                        name: this.hex
                    });

                    trackPoint.setStyle(getTrackPointStyle(this.altitude));
                    // planeTrackLayer.getSource().addFeature(trackPoint);
                }
            }
            else {
                // console.log('Adding plane '+this.flight);

                plane = new ol.Feature({
                    geometry: new ol.geom.Point(coordinates),
                });

                planeLayer.getSource().addFeature(plane);
            }

            plane.setId(this.hex);

            plane.set('dirty', false);
            plane.set('hex', this.hex);
            if (this.squawk == '0000') {
                plane.set('squawk', '----');
            }
            else {
                plane.set('squawk', this.squawk);
            }
            plane.set('messages', this.messages);
            plane.set('seen', this.seen);
            plane.set('altitude', this.altitude);
            plane.set('vert_rate', this.vert_rate);
            plane.set('speed', this.speed);
            plane.set('track', this.track);
            plane.set('flight', this.flight);

            plane.setStyle(getPlaneStyle(plane));
        });

        planeLayer.getSource().getFeatures().forEach(function (plane, index, array) {
            if (plane.get('dirty')) {
                // console.log('Removing plane '+plane.get('flight'));
                var hex = plane.get('hex');
                planeLayer.getSource().removeFeature(plane);

                planeTrackLayer.getSource().getFeatures().forEach(function (track, index, array) {
                    if (track.get('name') == hex) {
                        planeTrackLayer.getSource().removeFeature(track);
                    }
                });
            }
        });
    });
}

$('#planeInfoPopup').hide();

map.on('click', function(e) {
    var feature = map.forEachFeatureAtPixel(e.pixel,
        function(feature, layer) {
        return feature;
    });

    if (feature) {
        updateHeader(feature);
        // feature.setStyle(getPlaneStyle(feature, true));
        $('div#header').html(feature.get('flight')).css('height', '100px').show();
    }
    else {
        $('div#header').html('').css('height', '0').hide();
    }
});

map.on('pointermove', function(e) {
    if (e.dragging) {
        $('#planeInfoPopup').hide();
        return;
    }

    var pixel = map.getEventPixel(e.originalEvent);
    var hit = map.hasFeatureAtPixel(pixel);
    if (hit) {
        $('#'+map.getTarget()).css('cursor', 'pointer');
    }
    else {
        $('#'+map.getTarget()).css('cursor', '');
    }
});

function updateHeader(plane) {

}