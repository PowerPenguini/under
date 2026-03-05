import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import Hls from 'hls.js'
import * as satellite from 'satellite.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

const layers = [
  { id: 'satellite', label: 'Satellites', short: 'SAT' },
  { id: 'vessel', label: 'Vessels', short: 'SEA' },
  { id: 'aircraft', label: 'Aircraft', short: 'AIR' },
  { id: 'camera', label: 'Cameras', short: 'CAM' },
]

const intelObjects = [
  { id: 'sat-01', type: 'satellite', lat: 53.3, lng: 17.2, level: 'low' },
  { id: 'sat-02', type: 'satellite', lat: 41.2, lng: -71.6, level: 'medium' },
  { id: 'sea-01', type: 'vessel', lat: 36.2, lng: -5.3, level: 'high' },
  { id: 'sea-02', type: 'vessel', lat: 1.3, lng: 103.8, level: 'medium' },
  { id: 'air-01', type: 'aircraft', lat: 48.9, lng: 2.4, level: 'low' },
  { id: 'air-02', type: 'aircraft', lat: 25.2, lng: 55.3, level: 'high' },
  { id: 'cam-01', type: 'camera', lat: 40.7, lng: -74.0, level: 'low' },
  { id: 'cam-02', type: 'camera', lat: 35.7, lng: 139.7, level: 'medium' },
]

const HIGH_DETAIL_MODELS = [
  {
    id: 'hd-dubai',
    lng: 55.2708,
    lat: 25.2048,
    altitude: 0,
    scaleMeters: 14,
    rotation: [Math.PI / 2, 0, 0],
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Avocado/glTF-Binary/Avocado.glb',
  },
  {
    id: 'hd-london',
    lng: -0.1276,
    lat: 51.5072,
    altitude: 0,
    scaleMeters: 13,
    rotation: [Math.PI / 2, 0.25, 0],
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/RobotExpressive/glTF-Binary/RobotExpressive.glb',
  },
]

const GLOBE_PITCH = 24
const GLOBE_BEARING = -8
const OPENSKY_ENDPOINT = '/api/opensky/states/all'
const OPENSKY_REFRESH_MS = 30000
const OPENSKY_MAX_AIRCRAFT = 400
const CELESTRAK_TLE_ENDPOINT = '/api/celestrak/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
const SATELLITE_MAX_TRACKS = 100
const SATELLITE_TLE_REFRESH_MS = 15 * 60 * 1000
const SATELLITE_POSITION_REFRESH_MS = 1000
const SATELLITE_ORBIT_REFRESH_MS = 30000
const SATELLITE_ORBIT_SAMPLE_POINTS = 96
const SATELLITE_ALTITUDE_RENDER_SCALE = 0.2
const SATELLITE_PICK_RADIUS_PX = 24
const EARTH_SEARCH_ENDPOINT = '/api/earth-search/v1/search'
const SATELLITE_IMAGERY_LOOKBACK_DAYS = 14
const SATELLITE_IMAGERY_DEBOUNCE_MS = 300
const SATELLITE_IMAGERY_CACHE_TTL_MS = 5 * 60 * 1000
const OVERPASS_ENDPOINT = '/api/overpass/interpreter'
const MARINE_AIS_ENDPOINT =
  '/api/marineais/arcgis/rest/services/AIS/2017_US_Vessel_Traffic/FeatureServer/11/query'
const ONTARIO_CAMERAS_ENDPOINT = '/api/ontario511/api/v2/get/cameras'
const CALTRANS_CAMERAS_ENDPOINT = '/api/caltrans/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query'
const OVERPASS_REFRESH_MS = 60000
const OVERPASS_MAX_CAMERAS = 500
const MARINE_REFRESH_MS = 90000
const AIRCRAFT_ALTITUDE_EXAGGERATION = 6
const AIRCRAFT_BASE_ALTITUDE = 1200
const AIRCRAFT_MIN_SIZE_METERS = 12000
const AIRCRAFT_MAX_SIZE_METERS = 32000
const QUALITY_PROFILES = {
  high: {
    satMaxTracks: 100,
    satPositionRefreshMs: SATELLITE_POSITION_REFRESH_MS,
    satOrbitRefreshMs: SATELLITE_ORBIT_REFRESH_MS,
    satOrbitSamples: SATELLITE_ORBIT_SAMPLE_POINTS,
    airMaxTracks: 320,
    cameraMaxPoints: 420,
    seaMaxTracks: 260,
    cameraPreviewRefreshMs: 2000,
  },
  medium: {
    satMaxTracks: 70,
    satPositionRefreshMs: 1800,
    satOrbitRefreshMs: 45000,
    satOrbitSamples: 64,
    airMaxTracks: 220,
    cameraMaxPoints: 280,
    seaMaxTracks: 170,
    cameraPreviewRefreshMs: 2600,
  },
  low: {
    satMaxTracks: 40,
    satPositionRefreshMs: 3200,
    satOrbitRefreshMs: 60000,
    satOrbitSamples: 36,
    airMaxTracks: 130,
    cameraMaxPoints: 150,
    seaMaxTracks: 90,
    cameraPreviewRefreshMs: 3600,
  },
}

function buildOpenSkyUrl(bounds) {
  const params = new URLSearchParams({
    lamin: bounds.getSouth().toFixed(4),
    lomin: bounds.getWest().toFixed(4),
    lamax: bounds.getNorth().toFixed(4),
    lomax: bounds.getEast().toFixed(4),
  })
  return `${OPENSKY_ENDPOINT}?${params.toString()}`
}

function computeQualityProfile(map, isDocumentVisible) {
  if (!isDocumentVisible) {
    return 'low'
  }
  const zoom = map?.getZoom?.() ?? 2
  if (zoom < 2.1) {
    return 'low'
  }
  if (zoom < 4.3) {
    return 'medium'
  }
  return 'high'
}

function buildOverpassQuery(bounds) {
  const south = bounds.getSouth().toFixed(4)
  const west = bounds.getWest().toFixed(4)
  const north = bounds.getNorth().toFixed(4)
  const east = bounds.getEast().toFixed(4)
  return `[out:json][timeout:25];
(
  node["man_made"="surveillance"](${south},${west},${north},${east});
  way["man_made"="surveillance"](${south},${west},${north},${east});
  relation["man_made"="surveillance"](${south},${west},${north},${east});
  node["surveillance"="camera"](${south},${west},${north},${east});
  way["surveillance"="camera"](${south},${west},${north},${east});
  relation["surveillance"="camera"](${south},${west},${north},${east});
);
out center tags qt;`
}

function isWithinBounds(bounds, lat, lng) {
  return (
    lat <= bounds.getNorth() &&
    lat >= bounds.getSouth() &&
    lng <= bounds.getEast() &&
    lng >= bounds.getWest()
  )
}

function mapOverpassElementToCamera(element) {
  const lat = typeof element?.lat === 'number' ? element.lat : element?.center?.lat
  const lng = typeof element?.lon === 'number' ? element.lon : element?.center?.lon
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return null
  }

  const tags = element?.tags ?? {}
  const surveillanceType = tags['surveillance:type'] ?? tags.surveillance ?? 'camera'
  return {
    id: `cam-${element?.type ?? 'node'}-${element?.id ?? Math.random().toString(16).slice(2)}`,
    type: 'camera',
    lat,
    lng,
    level: 'medium',
    name: tags.name ?? `Camera ${element?.id ?? ''}`.trim(),
    operator: tags.operator ?? tags.brand ?? 'Unknown',
    surveillanceType,
    source: 'OSM / Overpass',
    status: 'open',
    previewUrl: null,
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

async function fetchOpenCameras(bounds, signal) {
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: buildOverpassQuery(bounds),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Overpass request failed with status ${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    throw new Error('Overpass payload is invalid')
  }

  const elements = Array.isArray(payload?.elements) ? payload.elements : []
  return elements
    .map(mapOverpassElementToCamera)
    .filter(Boolean)
    .slice(0, OVERPASS_MAX_CAMERAS)
}

async function fetchOntario511Cameras(bounds, signal) {
  const response = await fetch(ONTARIO_CAMERAS_ENDPOINT, { signal })
  if (!response.ok) {
    throw new Error(`Ontario 511 request failed with status ${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  if (!Array.isArray(payload)) {
    throw new Error('Ontario 511 payload is invalid')
  }

  const now = Math.floor(Date.now() / 1000)
  return payload
    .map((entry) => {
      const lat = typeof entry?.Latitude === 'number' ? entry.Latitude : null
      const lng = typeof entry?.Longitude === 'number' ? entry.Longitude : null
      if (lat === null || lng === null || !isWithinBounds(bounds, lat, lng)) {
        return null
      }

      const views = Array.isArray(entry?.Views) ? entry.Views : []
      const enabledView =
        views.find((view) => String(view?.Status ?? '').toLowerCase() === 'enabled') ?? views[0]
      const previewUrl = typeof enabledView?.Url === 'string' ? enabledView.Url : null

      return {
        id: `ontario-${entry?.Id ?? Math.random().toString(16).slice(2)}`,
        type: 'camera',
        lat,
        lng,
        level: 'medium',
        name: entry?.Location ?? `${entry?.Roadway ?? 'Road camera'} ${entry?.Direction ?? ''}`.trim(),
        operator: entry?.Source ?? 'Ontario 511',
        surveillanceType: 'traffic-camera',
        source: 'Ontario 511',
        status: previewUrl ? 'snapshot' : 'unavailable',
        previewUrl,
        updatedAt: now,
      }
    })
    .filter(Boolean)
}

async function fetchCaltransCameras(bounds, signal) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields:
      'OBJECTID,locationName,route,direction,inService,currentImageURL,streamingVideoURL,recordEpoch,currentImageUpdateFrequency',
    returnGeometry: 'true',
    f: 'pjson',
    outSR: '4326',
  })

  const response = await fetch(`${CALTRANS_CAMERAS_ENDPOINT}?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`Caltrans request failed with status ${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  const features = Array.isArray(payload?.features) ? payload.features : []
  const now = Math.floor(Date.now() / 1000)

  return features
    .map((feature) => {
      const lat = typeof feature?.geometry?.y === 'number' ? feature.geometry.y : null
      const lng = typeof feature?.geometry?.x === 'number' ? feature.geometry.x : null
      if (lat === null || lng === null || !isWithinBounds(bounds, lat, lng)) {
        return null
      }

      const attrs = feature?.attributes ?? {}
      const previewUrl = typeof attrs.currentImageURL === 'string' ? attrs.currentImageURL : null
      const streamUrl = typeof attrs.streamingVideoURL === 'string' ? attrs.streamingVideoURL : null
      const recordEpoch = typeof attrs.recordEpoch === 'number' ? attrs.recordEpoch : now

      return {
        id: `caltrans-${attrs.OBJECTID ?? Math.random().toString(16).slice(2)}`,
        type: 'camera',
        lat,
        lng,
        level: 'medium',
        name: attrs.locationName ?? `Caltrans camera ${attrs.OBJECTID ?? ''}`.trim(),
        operator: 'Caltrans',
        surveillanceType: 'traffic-camera',
        source: 'Caltrans CCTV',
        status: streamUrl ? 'live' : previewUrl ? 'snapshot' : 'unavailable',
        previewUrl,
        streamUrl: streamUrl || null,
        updatedAt: recordEpoch,
      }
    })
    .filter(Boolean)
}

function dedupeCameraPoints(points) {
  const byKey = new Map()
  points.forEach((point) => {
    const key = `${point.lat.toFixed(4)}:${point.lng.toFixed(4)}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, point)
      return
    }

    const score = (item) =>
      item.status === 'live' ? 4 : item.status === 'snapshot' ? 3 : item.status === 'unavailable' ? 2 : 1
    if (score(point) > score(existing)) {
      byKey.set(key, point)
    }
  })
  return [...byKey.values()]
}

async function fetchAggregatedCameras(bounds, signal) {
  const [ontarioResult, caltransResult, overpassResult] = await Promise.allSettled([
    fetchOntario511Cameras(bounds, signal),
    fetchCaltransCameras(bounds, signal),
    fetchOpenCameras(bounds, signal),
  ])

  const ontario = ontarioResult.status === 'fulfilled' ? ontarioResult.value : []
  const caltrans = caltransResult.status === 'fulfilled' ? caltransResult.value : []
  const overpass = overpassResult.status === 'fulfilled' ? overpassResult.value : []
  const merged = dedupeCameraPoints([...ontario, ...caltrans, ...overpass]).slice(
    0,
    OVERPASS_MAX_CAMERAS,
  )

  if (merged.length > 0) {
    return merged
  }

  if (
    ontarioResult.status === 'rejected' &&
    caltransResult.status === 'rejected' &&
    overpassResult.status === 'rejected'
  ) {
    throw new Error('All camera providers failed')
  }

  return merged
}

function mapMarineFeatureToTrack(feature) {
  const attributes = feature?.attributes ?? {}
  const paths = Array.isArray(feature?.geometry?.paths) ? feature.geometry.paths : []
  const lastPath = paths.length > 0 ? paths[paths.length - 1] : null
  const lastCoord = Array.isArray(lastPath) && lastPath.length > 0 ? lastPath[lastPath.length - 1] : null
  if (!Array.isArray(lastCoord) || typeof lastCoord[0] !== 'number' || typeof lastCoord[1] !== 'number') {
    return null
  }

  const speed = typeof attributes.mean_sog === 'number' ? attributes.mean_sog : null
  const level = speed !== null && speed > 14 ? 'high' : speed !== null && speed > 8 ? 'medium' : 'low'
  const mmsi = attributes.mmsi ? String(attributes.mmsi) : `obj-${attributes.OBJECTID ?? Math.random().toString(16).slice(2)}`

  return {
    id: `sea-${mmsi}`,
    type: 'vessel',
    mmsi,
    name: attributes.vessel_name ?? `Vessel ${mmsi}`,
    vesselType: attributes.vessel_type ?? null,
    vesselClass: attributes.vessel_class ?? null,
    vesselGroup: attributes.vessel_group ?? null,
    speedKnots: speed,
    course: typeof attributes.mean_cog === 'number' ? attributes.mean_cog : null,
    lat: lastCoord[1],
    lng: lastCoord[0],
    updatedAt:
      typeof attributes.end_date === 'number'
        ? Math.floor(attributes.end_date / 1000)
        : Math.floor(Date.now() / 1000),
    source: 'NOAA MarineCadastre AIS 2017',
    level,
  }
}

async function fetchMarineTracks(bounds, signal, limit) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'OBJECTID,mmsi,vessel_name,vessel_type,mean_sog,mean_cog,end_date,vessel_class,vessel_group',
    geometry: `${bounds.getWest().toFixed(4)},${bounds.getSouth().toFixed(4)},${bounds.getEast().toFixed(4)},${bounds.getNorth().toFixed(4)}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(Math.max(20, limit)),
    f: 'pjson',
  })

  const response = await fetch(`${MARINE_AIS_ENDPOINT}?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`Marine AIS request failed with status ${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  const features = Array.isArray(payload?.features) ? payload.features : []
  return features.map(mapMarineFeatureToTrack).filter(Boolean).slice(0, limit)
}


function mapOpenSkyStateToAircraft(state) {
  const longitude = state?.[5]
  const latitude = state?.[6]
  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return null
  }

  const geoAltitude = typeof state?.[13] === 'number' ? state[13] : 0
  const level = geoAltitude > 10000 ? 'low' : geoAltitude > 3500 ? 'medium' : 'high'

  return {
    id: state?.[0] ?? `air-${Math.random().toString(16).slice(2)}`,
    type: 'aircraft',
    icao24: state?.[0] ?? 'unknown',
    lng: longitude,
    lat: latitude,
    heading: typeof state?.[10] === 'number' ? state[10] : 0,
    velocity: typeof state?.[9] === 'number' ? state[9] : null,
    geoAltitude: typeof state?.[13] === 'number' ? state[13] : null,
    callsign: (state?.[1] ?? '').trim() || 'UNKNOWN',
    level,
  }
}

function mapAltitudeKmToLevel(altitudeKm) {
  if (altitudeKm >= 1200) {
    return 'low'
  }
  if (altitudeKm >= 550) {
    return 'medium'
  }
  return 'high'
}

function levelColorHex(level) {
  if (level === 'critical') {
    return '#ff3f6a'
  }
  if (level === 'high') {
    return '#ff8a1f'
  }
  if (level === 'medium') {
    return '#ffd400'
  }
  return '#27d3ff'
}

function parseCelesTrakTle(tleText) {
  const lines = tleText
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  const catalog = []
  for (let index = 0; index + 2 < lines.length; index += 3) {
    const name = lines[index]
    const line1 = lines[index + 1]
    const line2 = lines[index + 2]
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      continue
    }

    try {
      const satrec = satellite.twoline2satrec(line1, line2)
      const satnum = satrec?.satnum ? String(satrec.satnum).trim() : line1.slice(2, 7).trim()
      catalog.push({
        id: `sat-${satnum || index + 1}`,
        name: name || `Satellite ${satnum || index + 1}`,
        noradId: satnum || 'unknown',
        satrec,
      })
    } catch {
      continue
    }
  }

  return catalog.slice(0, SATELLITE_MAX_TRACKS)
}

function propagateSatellitePositions(catalog, nowDate = new Date(), maxTracks = SATELLITE_MAX_TRACKS) {
  const gmst = satellite.gstime(nowDate)
  const updatedAt = Math.floor(nowDate.getTime() / 1000)

  return catalog
    .slice(0, maxTracks)
    .map((entry) => {
      const propagated = satellite.propagate(entry.satrec, nowDate)
      const eciPosition = propagated?.position
      const eciVelocity = propagated?.velocity
      if (!eciPosition) {
        return null
      }

      const geodetic = satellite.eciToGeodetic(eciPosition, gmst)
      const lat = satellite.degreesLat(geodetic.latitude)
      const lng = satellite.degreesLong(geodetic.longitude)
      const altitudeKm = geodetic.height

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !Number.isFinite(altitudeKm) ||
        lat > 90 ||
        lat < -90 ||
        lng > 180 ||
        lng < -180 ||
        altitudeKm < -1
      ) {
        return null
      }

      const velocityKms = eciVelocity
        ? Math.sqrt(
            eciVelocity.x * eciVelocity.x +
              eciVelocity.y * eciVelocity.y +
              eciVelocity.z * eciVelocity.z,
          )
        : null

      return {
        id: entry.id,
        type: 'satellite',
        name: entry.name,
        noradId: entry.noradId,
        lat,
        lng,
        altitudeKm,
        velocityKms: Number.isFinite(velocityKms) ? velocityKms : null,
        updatedAt,
        level: mapAltitudeKmToLevel(altitudeKm),
      }
    })
    .filter(Boolean)
}

function buildSatelliteOrbitPaths(
  catalog,
  nowDate = new Date(),
  samplePoints = SATELLITE_ORBIT_SAMPLE_POINTS,
  maxTracks = SATELLITE_MAX_TRACKS,
) {
  return catalog
    .slice(0, maxTracks)
    .map((entry) => {
      const meanMotionRadPerMinute =
        typeof entry?.satrec?.no === 'number' && entry.satrec.no > 0 ? entry.satrec.no : null
      if (!meanMotionRadPerMinute) {
        return null
      }

      const orbitPeriodMinutes = (Math.PI * 2) / meanMotionRadPerMinute
      if (!Number.isFinite(orbitPeriodMinutes) || orbitPeriodMinutes <= 0) {
        return null
      }

      const points = []
      for (let index = 0; index <= samplePoints; index += 1) {
        const offsetMinutes = (orbitPeriodMinutes * index) / samplePoints
        const sampleDate = new Date(nowDate.getTime() + offsetMinutes * 60 * 1000)
        const gmst = satellite.gstime(sampleDate)
        const propagated = satellite.propagate(entry.satrec, sampleDate)
        const eciPosition = propagated?.position
        if (!eciPosition) {
          continue
        }
        const geodetic = satellite.eciToGeodetic(eciPosition, gmst)
        const lat = satellite.degreesLat(geodetic.latitude)
        const lng = satellite.degreesLong(geodetic.longitude)
        const altitudeKm = geodetic.height
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          !Number.isFinite(altitudeKm) ||
          lat > 90 ||
          lat < -90 ||
          lng > 180 ||
          lng < -180 ||
          altitudeKm < -1
        ) {
          continue
        }
        points.push({ lat, lng, altitudeKm })
      }

      if (points.length < 4) {
        return null
      }

      const level = mapAltitudeKmToLevel(points[0]?.altitudeKm ?? 0)
      return {
        id: entry.id,
        level,
        points,
      }
    })
    .filter(Boolean)
}

async function fetchCelesTrakCatalog(signal) {
  const response = await fetch(CELESTRAK_TLE_ENDPOINT, { signal })
  if (!response.ok) {
    throw new Error(`CelesTrak request failed with status ${response.status}`)
  }
  const tleText = await response.text()
  const catalog = parseCelesTrakTle(tleText)
  if (catalog.length === 0) {
    throw new Error('CelesTrak payload is empty')
  }
  return catalog
}

function buildImageryDatetimeWindow(nowDate = new Date()) {
  const endIso = nowDate.toISOString()
  const startDate = new Date(nowDate.getTime() - SATELLITE_IMAGERY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  return `${startDate.toISOString()}/${endIso}`
}

function buildSatelliteImageryCacheKey(track) {
  return `sat:${track.id}`
}

function mapStacFeatureToImagery(feature) {
  const assets = feature?.assets ?? {}
  const properties = feature?.properties ?? {}
  const links = Array.isArray(feature?.links) ? feature.links : []

  const thumbnailUrl =
    assets?.thumbnail?.href ??
    assets?.rendered_preview?.href ??
    assets?.visual?.href ??
    links.find((link) => link?.rel === 'thumbnail')?.href ??
    null

  const sceneUrl =
    feature?.id && feature?.collection
      ? `https://earth-search.aws.element84.com/v1/collections/${feature.collection}/items/${feature.id}`
      : feature?.id
        ? `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${feature.id}`
        : null

  return {
    sceneId: feature?.id ?? 'unknown-scene',
    collection: feature?.collection ?? 'unknown',
    thumbnailUrl,
    sceneUrl,
    capturedAt: properties?.datetime ?? properties?.created ?? null,
    platform: properties?.platform ?? 'unknown',
    constellation: properties?.constellation ?? 'unknown',
    cloudCover: typeof properties?.['eo:cloud_cover'] === 'number' ? properties['eo:cloud_cover'] : null,
    provider: 'Earth Search STAC',
  }
}

async function fetchLatestSatelliteImagery(track, signal) {
  const payload = {
    collections: ['sentinel-2-l2a', 'landsat-c2-l2'],
    intersects: {
      type: 'Point',
      coordinates: [track.lng, track.lat],
    },
    datetime: buildImageryDatetimeWindow(new Date()),
    limit: 1,
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  }

  const response = await fetch(EARTH_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Earth Search request failed with status ${response.status}`)
  }

  const json = await response.json().catch(() => null)
  const feature = Array.isArray(json?.features) ? json.features[0] : null
  if (!feature) {
    return null
  }
  return mapStacFeatureToImagery(feature)
}

async function fetchOpenSkyAircraft(bounds, signal) {
  const response = await fetch(buildOpenSkyUrl(bounds), { signal })
  if (!response.ok) {
    throw new Error(`OpenSky request failed with status ${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenSky payload is invalid')
  }
  const states = Array.isArray(payload?.states) ? payload.states : []
  const snapshotTime = typeof payload?.time === 'number' ? payload.time : Math.floor(Date.now() / 1000)
  return states
    .map((state) => {
      const mapped = mapOpenSkyStateToAircraft(state)
      if (!mapped) {
        return null
      }
      return { ...mapped, updatedAt: snapshotTime }
    })
    .filter(Boolean)
    .slice(0, OPENSKY_MAX_AIRCRAFT)
}

function LayerIcon({ kind }) {
  if (kind === 'satellite') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10l4-4 6 6-4 4-6-6z" />
        <path d="M14 6l4-2 2 2-2 4" />
        <path d="M6 14l-2 4 2 2 4-2" />
      </svg>
    )
  }

  if (kind === 'vessel') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 13h16l-2 4H6l-2-4z" />
        <path d="M12 6v7" />
        <path d="M8 8h8" />
      </svg>
    )
  }

  if (kind === 'aircraft') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12l18-4-7 4 7 4-18-4z" />
        <path d="M10 11l-2-5" />
        <path d="M10 13l-2 5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="6" width="14" height="10" rx="2" />
      <circle cx="12" cy="11" r="2.5" />
      <path d="M9 18h6" />
    </svg>
  )
}

function CameraStreamPlayer({ streamUrl, name }) {
  const videoRef = useRef(null)
  const [streamError, setStreamError] = useState(false)

  const streamKind = useMemo(() => {
    if (!streamUrl) {
      return 'unknown'
    }
    return /\.m3u8(\?|$)/i.test(streamUrl) ? 'hls' : 'file'
  }, [streamUrl])

  const streamSupported = useMemo(() => {
    if (streamKind !== 'hls') {
      return true
    }
    if (typeof document === 'undefined') {
      return false
    }
    const probe = document.createElement('video')
    const nativeHls =
      probe.canPlayType('application/vnd.apple.mpegurl') ||
      probe.canPlayType('application/x-mpegURL')
    return Boolean(nativeHls) || Hls.isSupported()
  }, [streamKind])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl || !streamSupported) {
      return
    }

    let hls = null
    let isCancelled = false

    const onPlaybackError = () => {
      if (!isCancelled) {
        setStreamError(true)
      }
    }

    video.addEventListener('error', onPlaybackError)

    if (streamKind === 'hls') {
      const supportsNativeHls =
        video.canPlayType('application/vnd.apple.mpegurl') ||
        video.canPlayType('application/x-mpegURL')

      if (supportsNativeHls) {
        video.src = streamUrl
      } else if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        })
        hls.attachMedia(video)
        hls.loadSource(streamUrl)
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal && !isCancelled) {
            setStreamError(true)
          }
        })
      } else {
        return
      }
    } else {
      video.src = streamUrl
    }

    const playPromise = video.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (!isCancelled) {
          setStreamError(true)
        }
      })
    }

    return () => {
      isCancelled = true
      video.removeEventListener('error', onPlaybackError)
      if (hls) {
        hls.destroy()
      }
      video.removeAttribute('src')
      video.load()
    }
  }, [streamKind, streamSupported, streamUrl])

  if (!streamSupported || streamError) {
    return (
      <div className="camera-preview-placeholder">
        Stream unavailable in embedded player. Use provider link below.
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      className="camera-preview-image"
      controls
      autoPlay
      muted
      playsInline
      aria-label={`Live stream ${name}`}
    />
  )
}

function MapViewport({ objects, activeLayerIds, showBuildings3D, showHighDetail3D }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const activeLayersRef = useRef({
    satellite: activeLayerIds.includes('satellite'),
    aircraft: activeLayerIds.includes('aircraft'),
    camera: activeLayerIds.includes('camera'),
  })
  const projectionModeRef = useRef('mercator')
  const highDetailVisibleRef = useRef(showHighDetail3D)
  const satelliteCatalogRef = useRef([])
  const staticModelsGroupRef = useRef(null)
  const aircraftGroupRef = useRef(null)
  const satelliteGroupRef = useRef(null)
  const orbitGroupRef = useRef(null)
  const projectionMatrixRef = useRef(new THREE.Matrix4())
  const cameraPreviewSrcRef = useRef(null)
  const documentVisibleRef = useRef(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true)
  const satelliteImageryCacheRef = useRef(new Map())
  const satelliteTracksRef = useRef([])
  const [qualityProfile, setQualityProfile] = useState('medium')
  const [satelliteTracks, setSatelliteTracks] = useState([])
  const [satelliteOrbitPaths, setSatelliteOrbitPaths] = useState([])
  const [selectedSatelliteId, setSelectedSatelliteId] = useState(null)
  const [satelliteImageryState, setSatelliteImageryState] = useState({
    status: 'idle',
    data: null,
    error: null,
  })
  const [aircraftTracks, setAircraftTracks] = useState([])
  const [selectedFlightId, setSelectedFlightId] = useState(null)
  const [cameraPoints, setCameraPoints] = useState([])
  const [selectedCameraId, setSelectedCameraId] = useState(null)
  const [marineTracks, setMarineTracks] = useState([])
  const [selectedMarineId, setSelectedMarineId] = useState(null)
  const [cameraPreviewLive, setCameraPreviewLive] = useState(true)
  const [cameraPreviewTick, setCameraPreviewTick] = useState(0)
  const [cameraPreviewSrc, setCameraPreviewSrc] = useState(null)
  const qualityConfig = useMemo(
    () => QUALITY_PROFILES[qualityProfile] ?? QUALITY_PROFILES.medium,
    [qualityProfile],
  )
  const isSatelliteActive = activeLayerIds.includes('satellite')
  const isAircraftActive = activeLayerIds.includes('aircraft')
  const isCameraActive = activeLayerIds.includes('camera')
  const isVesselActive = activeLayerIds.includes('vessel')

  useEffect(() => {
    highDetailVisibleRef.current = showHighDetail3D
  }, [showHighDetail3D])

  useEffect(() => {
    activeLayersRef.current = {
      satellite: isSatelliteActive,
      aircraft: isAircraftActive,
      camera: isCameraActive,
    }
  }, [isSatelliteActive, isAircraftActive, isCameraActive])

  useEffect(() => {
    satelliteTracksRef.current = satelliteTracks
  }, [satelliteTracks])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          satelliteImagery: {
            type: 'raster',
            tiles: [
              'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution:
              'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          },
          boundariesPlacesReference: {
            type: 'raster',
            tiles: [
              'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution: 'Reference &copy; Esri',
          },
          openBuildings: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [
          { id: 'satellite-imagery', type: 'raster', source: 'satelliteImagery' },
          {
            id: 'world-boundaries-places',
            type: 'raster',
            source: 'boundariesPlacesReference',
            paint: { 'raster-opacity': 0.97 },
          },
          {
            id: 'buildings-3d',
            type: 'fill-extrusion',
            source: 'openBuildings',
            'source-layer': 'building',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'render_height'], 0],
                0,
                '#d5d8de',
                70,
                '#b7bcc5',
                180,
                '#9aa1ac',
              ],
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.68,
            },
          },
        ],
      },
      center: [15, 30],
      zoom: 1.8,
      minZoom: 1.3,
      maxZoom: 18,
      maxPitch: 70,
      attributionControl: false,
    })

    const map = mapRef.current
    let layerAdded = false
    const applyQualityProfile = () => {
      setQualityProfile(computeQualityProfile(map, documentVisibleRef.current))
    }

    const enableGlobeMode = () => {
      if (projectionModeRef.current === 'globe') {
        return
      }

      try {
        map.setProjection({ type: 'globe' })
        projectionModeRef.current = 'globe'
      } catch {
        map.setProjection({ type: 'mercator' })
        projectionModeRef.current = 'mercator'
        return
      }

      map.easeTo({
        duration: 700,
        pitch: GLOBE_PITCH,
        bearing: GLOBE_BEARING,
      })
    }

    const addHighDetailLayer = () => {
      if (layerAdded || map.getLayer('high-detail-models')) {
        return
      }

      let scene
      let camera
      let renderer

      map.addLayer({
        id: 'high-detail-models',
        type: 'custom',
        renderingMode: '3d',
        onAdd: (_map, gl) => {
          scene = new THREE.Scene()
          camera = new THREE.Camera()

          const lightA = new THREE.DirectionalLight(0xffffff, 0.65)
          lightA.position.set(0, -70, 100).normalize()
          scene.add(lightA)
          scene.add(new THREE.AmbientLight(0xffffff, 0.5))

          const staticModelsGroup = new THREE.Group()
          const aircraftGroup = new THREE.Group()
          const satelliteGroup = new THREE.Group()
          const orbitGroup = new THREE.Group()
          scene.add(staticModelsGroup)
          scene.add(aircraftGroup)
          scene.add(satelliteGroup)
          scene.add(orbitGroup)
          staticModelsGroupRef.current = staticModelsGroup
          aircraftGroupRef.current = aircraftGroup
          satelliteGroupRef.current = satelliteGroup
          orbitGroupRef.current = orbitGroup

          renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
          })
          renderer.autoClear = false

          const loader = new GLTFLoader()
          HIGH_DETAIL_MODELS.forEach((item) => {
            loader.load(
              item.url,
              (gltf) => {
                const model = gltf.scene
                const [rx = Math.PI / 2, ry = 0, rz = 0] = item.rotation ?? []
                const locationMatrix = new THREE.Matrix4().fromArray(
                  map.transform.getMatrixForModel([item.lng, item.lat], item.altitude ?? 0),
                )

                const modelMatrix = locationMatrix
                  .scale(new THREE.Vector3(item.scaleMeters, item.scaleMeters, item.scaleMeters))
                  .multiply(new THREE.Matrix4().makeRotationX(rx))
                  .multiply(new THREE.Matrix4().makeRotationY(ry))
                  .multiply(new THREE.Matrix4().makeRotationZ(rz))

                model.matrixAutoUpdate = false
                model.matrix.copy(modelMatrix)
                model.visible = highDetailVisibleRef.current
                staticModelsGroup.add(model)
              },
              undefined,
              () => {},
            )
          })
        },
        render: (_gl, args) => {
          if (!scene || !camera || !renderer) {
            return
          }
          if (staticModelsGroupRef.current) {
            staticModelsGroupRef.current.visible = highDetailVisibleRef.current
          }
          if (aircraftGroupRef.current) {
            aircraftGroupRef.current.visible = activeLayersRef.current.aircraft
          }
          if (satelliteGroupRef.current) {
            satelliteGroupRef.current.visible = activeLayersRef.current.satellite
          }
          if (orbitGroupRef.current) {
            orbitGroupRef.current.visible = activeLayersRef.current.satellite
          }
          camera.projectionMatrix = new THREE.Matrix4().fromArray(
            args.defaultProjectionData.mainMatrix,
          )
          projectionMatrixRef.current.copy(camera.projectionMatrix)
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
          camera.matrixWorld.identity()
          camera.matrixWorldInverse.identity()
          renderer.resetState()
          renderer.render(scene, camera)
          if (
            documentVisibleRef.current &&
            (activeLayersRef.current.satellite || activeLayersRef.current.aircraft)
          ) {
            map.triggerRepaint()
          }
        },
      })

      layerAdded = true
    }

    const onStyleLoad = () => {
      enableGlobeMode()
      addHighDetailLayer()
    }

    map.on('style.load', onStyleLoad)
    map.on('zoomend', applyQualityProfile)
    map.on('moveend', applyQualityProfile)

    const onVisibilityChange = () => {
      documentVisibleRef.current = document.visibilityState === 'visible'
      applyQualityProfile()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    if (map.isStyleLoaded()) {
      onStyleLoad()
    }
    applyQualityProfile()

    return () => {
      map.off('style.load', onStyleLoad)
      map.off('zoomend', applyQualityProfile)
      map.off('moveend', applyQualityProfile)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      markersRef.current.forEach((marker) => marker.remove())
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) {
      return
    }

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    const renderedObjects = [
      ...objects,
      ...(isCameraActive ? cameraPoints : []),
      ...(isVesselActive ? marineTracks : []),
    ]

    renderedObjects.forEach((item) => {
      const markerElement = document.createElement('span')
      markerElement.dataset.level = item.level

      if (item.type === 'camera') {
        markerElement.className = 'intel-marker intel-marker-camera'
        markerElement.innerHTML =
          '<span class="camera-glyph"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="10" rx="2"/><circle cx="12" cy="11" r="2.8"/><path d="M9 18h6"/></svg></span>'
        markerElement.setAttribute('aria-label', `Show camera details for ${item.name ?? item.id}`)
        markerElement.addEventListener('click', () => {
          setSelectedCameraId(item.id)
        })
      } else if (item.type === 'vessel') {
        markerElement.className = 'intel-marker intel-marker-vessel'
        markerElement.innerHTML =
          '<span class="vessel-glyph"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 8 10h8z"/><path d="M4 12h16l-2.4 5.2H6.4z"/><path d="M6 18.2c1.4.9 2.8 1.3 4.2 1.3s2.8-.4 4.2-1.3c1.1.8 2.2 1.2 3.4 1.2"/></svg></span>'
        markerElement.style.setProperty('--vessel-rotation', `${Math.round(item.course ?? 0)}deg`)
        markerElement.setAttribute('aria-label', `Show vessel details for ${item.name ?? item.id}`)
        markerElement.addEventListener('click', () => {
          setSelectedMarineId(item.id)
        })
      } else {
        markerElement.className = 'intel-marker'
      }

      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat([item.lng, item.lat])
        .addTo(mapRef.current)

      markersRef.current.push(marker)
    })
  }, [objects, cameraPoints, marineTracks, isCameraActive, isVesselActive])

  useEffect(() => {
    const map = mapRef.current
    const satelliteGroup = satelliteGroupRef.current
    if (!map || !satelliteGroup) {
      return
    }

    while (satelliteGroup.children.length > 0) {
      const child = satelliteGroup.children.pop()
      if (child?.geometry) {
        child.geometry.dispose()
      }
      if (child?.material?.dispose) {
        child.material.dispose()
      }
    }

    if (!isSatelliteActive) {
      map.triggerRepaint()
      return
    }

    satelliteTracks.forEach((track) => {
      const rawAltitudeMeters = Math.max(0, (track.altitudeKm ?? 0) * 1000)
      const displayAltitude = rawAltitudeMeters * SATELLITE_ALTITUDE_RENDER_SCALE
      const sizedMeters = Math.max(32000, Math.min(76000, 32000 + rawAltitudeMeters * 0.006))

      const geometry = new THREE.OctahedronGeometry(1.15, 0)
      const color =
        levelColorHex(track.level)
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.52,
        roughness: 0.35,
        metalness: 0.18,
      })

      const mesh = new THREE.Mesh(geometry, material)
      const locationMatrix = new THREE.Matrix4().fromArray(
        map.transform.getMatrixForModel([track.lng, track.lat], displayAltitude),
      )
      const modelMatrix = locationMatrix.scale(new THREE.Vector3(sizedMeters, sizedMeters, sizedMeters))

      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(modelMatrix)
      mesh.userData.satelliteId = track.id
      satelliteGroup.add(mesh)
    })

    map.triggerRepaint()
  }, [isSatelliteActive, satelliteTracks])

  useEffect(() => {
    const map = mapRef.current
    const orbitGroup = orbitGroupRef.current
    if (!map || !orbitGroup) {
      return
    }

    while (orbitGroup.children.length > 0) {
      const child = orbitGroup.children.pop()
      if (child?.geometry) {
        child.geometry.dispose()
      }
      if (child?.material?.dispose) {
        child.material.dispose()
      }
    }

    if (!isSatelliteActive) {
      map.triggerRepaint()
      return
    }

    const selectedOrbit =
      satelliteOrbitPaths.find((orbitPath) => orbitPath.id === selectedSatelliteId) ?? null
    if (!selectedOrbit) {
      map.triggerRepaint()
      return
    }

    ;[selectedOrbit].forEach((orbitPath) => {
      const positions = []
      orbitPath.points.forEach((point) => {
        const modelMatrix = map.transform.getMatrixForModel(
          [point.lng, point.lat],
          Math.max(0, point.altitudeKm * 1000) * SATELLITE_ALTITUDE_RENDER_SCALE,
        )
        positions.push(modelMatrix[12], modelMatrix[13], modelMatrix[14])
      })

      if (positions.length < 12) {
        return
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))

      const material = new THREE.LineBasicMaterial({
        color: levelColorHex(orbitPath.level),
        transparent: true,
        opacity: 0.62,
      })

      const line = new THREE.Line(geometry, material)
      line.userData.satelliteId = orbitPath.id
      orbitGroup.add(line)
    })

    map.triggerRepaint()
  }, [isSatelliteActive, satelliteOrbitPaths, selectedSatelliteId])

  useEffect(() => {
    const map = mapRef.current
    const aircraftGroup = aircraftGroupRef.current
    if (!map || !aircraftGroup) {
      return
    }

    while (aircraftGroup.children.length > 0) {
      const child = aircraftGroup.children.pop()
      if (child?.geometry) {
        child.geometry.dispose()
      }
      if (child?.material?.dispose) {
        child.material.dispose()
      }
    }

    if (!isAircraftActive) {
      map.triggerRepaint()
      return
    }

    aircraftTracks.forEach((track) => {
      const rawAltitude = track.geoAltitude ?? 0
      const displayAltitude =
        Math.max(0, rawAltitude) * AIRCRAFT_ALTITUDE_EXAGGERATION + AIRCRAFT_BASE_ALTITUDE
      const sizedMeters = Math.max(
        AIRCRAFT_MIN_SIZE_METERS,
        Math.min(AIRCRAFT_MAX_SIZE_METERS, 9000 + Math.max(0, rawAltitude) * 0.55),
      )
      const headingRad = ((track.heading ?? 0) * Math.PI) / 180

      const geometry = new THREE.ConeGeometry(0.85, 2.8, 3)
      const color =
        track.level === 'critical'
          ? '#ff2965'
          : track.level === 'high'
            ? '#ff8a00'
            : track.level === 'medium'
              ? '#ffe600'
              : '#00d9ff'
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.62,
        roughness: 0.28,
        metalness: 0.08,
      })

      const mesh = new THREE.Mesh(geometry, material)
      const locationMatrix = new THREE.Matrix4().fromArray(
        map.transform.getMatrixForModel([track.lng, track.lat], displayAltitude),
      )
      const modelMatrix = locationMatrix
        .scale(new THREE.Vector3(sizedMeters, sizedMeters, sizedMeters))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeRotationZ(-headingRad))

      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(modelMatrix)
      mesh.userData.flightId = track.id
      aircraftGroup.add(mesh)
    })

    map.triggerRepaint()
  }, [aircraftTracks, isAircraftActive])

  useEffect(() => {
    if (!isAircraftActive) {
      setSelectedFlightId(null)
      return
    }

    if (!selectedFlightId && aircraftTracks.length > 0) {
      setSelectedFlightId(aircraftTracks[0].id)
      return
    }

    if (selectedFlightId && !aircraftTracks.some((track) => track.id === selectedFlightId)) {
      setSelectedFlightId(aircraftTracks[0]?.id ?? null)
    }
  }, [isAircraftActive, aircraftTracks, selectedFlightId])

  useEffect(() => {
    if (!isCameraActive) {
      setSelectedCameraId(null)
      return
    }

    if (!selectedCameraId && cameraPoints.length > 0) {
      setSelectedCameraId(cameraPoints[0].id)
      return
    }

    if (selectedCameraId && !cameraPoints.some((camera) => camera.id === selectedCameraId)) {
      setSelectedCameraId(cameraPoints[0]?.id ?? null)
    }
  }, [isCameraActive, cameraPoints, selectedCameraId])

  useEffect(() => {
    if (!isSatelliteActive) {
      setSelectedSatelliteId(null)
      return
    }

    if (!selectedSatelliteId && satelliteTracks.length > 0) {
      setSelectedSatelliteId(satelliteTracks[0].id)
      return
    }

    if (selectedSatelliteId && !satelliteTracks.some((satelliteTrack) => satelliteTrack.id === selectedSatelliteId)) {
      setSelectedSatelliteId(satelliteTracks[0]?.id ?? null)
    }
  }, [isSatelliteActive, satelliteTracks, selectedSatelliteId])

  useEffect(() => {
    if (!isVesselActive) {
      setSelectedMarineId(null)
      return
    }

    if (!selectedMarineId && marineTracks.length > 0) {
      setSelectedMarineId(marineTracks[0].id)
      return
    }

    if (selectedMarineId && !marineTracks.some((track) => track.id === selectedMarineId)) {
      setSelectedMarineId(marineTracks[0]?.id ?? null)
    }
  }, [isVesselActive, marineTracks, selectedMarineId])

  useEffect(() => {
    if (!mapRef.current || !isSatelliteActive) {
      return
    }

    let tleTimerId
    let positionTimerId
    let orbitTimerId
    let currentController
    let isMounted = true

    const updatePositions = () => {
      if (!isMounted) {
        return
      }
      if (!documentVisibleRef.current) {
        return
      }
      const catalog = satelliteCatalogRef.current
      if (catalog.length === 0) {
        return
      }
      const nextTracks = propagateSatellitePositions(
        catalog,
        new Date(),
        qualityConfig.satMaxTracks,
      )
      if (nextTracks.length > 0) {
        setSatelliteTracks(nextTracks)
      }
    }

    const pullCatalog = async () => {
      if (currentController) {
        currentController.abort()
      }
      const controller = new AbortController()
      currentController = controller

      try {
        const nextCatalog = await fetchCelesTrakCatalog(controller.signal)
        if (!isMounted) {
          return
        }
        satelliteCatalogRef.current = nextCatalog
        const nextTracks = propagateSatellitePositions(
          nextCatalog,
          new Date(),
          qualityConfig.satMaxTracks,
        )
        const nextOrbitPaths = buildSatelliteOrbitPaths(
          nextCatalog,
          new Date(),
          qualityConfig.satOrbitSamples,
          qualityConfig.satMaxTracks,
        )
        setSatelliteTracks(nextTracks)
        setSatelliteOrbitPaths(nextOrbitPaths)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        setSatelliteTracks((prev) => prev)
        setSatelliteOrbitPaths((prev) => prev)
      }
    }

    const refreshOrbits = () => {
      if (!isMounted) {
        return
      }
      const catalog = satelliteCatalogRef.current
      if (catalog.length === 0) {
        return
      }
      setSatelliteOrbitPaths(
        buildSatelliteOrbitPaths(
          catalog,
          new Date(),
          qualityConfig.satOrbitSamples,
          qualityConfig.satMaxTracks,
        ),
      )
    }

    void pullCatalog()
    tleTimerId = window.setInterval(() => {
      void pullCatalog()
    }, SATELLITE_TLE_REFRESH_MS)
    positionTimerId = window.setInterval(() => {
      updatePositions()
    }, qualityConfig.satPositionRefreshMs)
    orbitTimerId = window.setInterval(() => {
      refreshOrbits()
    }, qualityConfig.satOrbitRefreshMs)

    return () => {
      isMounted = false
      satelliteCatalogRef.current = []
      if (currentController) {
        currentController.abort()
      }
      if (tleTimerId) {
        window.clearInterval(tleTimerId)
      }
      if (positionTimerId) {
        window.clearInterval(positionTimerId)
      }
      if (orbitTimerId) {
        window.clearInterval(orbitTimerId)
      }
    }
  }, [isSatelliteActive, qualityConfig])

  useEffect(() => {
    if (!mapRef.current || !isSatelliteActive) {
      return
    }

    const map = mapRef.current
    const worldPoint = new THREE.Vector4()
    const onMapClick = (event) => {
      if (satelliteTracks.length === 0) {
        return
      }

      const canvas = map.getCanvas()
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const projectionMatrix = projectionMatrixRef.current

      let nearestId = null
      let nearestDistance = Number.POSITIVE_INFINITY

      satelliteTracks.forEach((track) => {
        const altitudeMeters =
          Math.max(0, (track.altitudeKm ?? 0) * 1000) * SATELLITE_ALTITUDE_RENDER_SCALE
        const modelMatrix = map.transform.getMatrixForModel([track.lng, track.lat], altitudeMeters)
        worldPoint.set(modelMatrix[12], modelMatrix[13], modelMatrix[14], 1).applyMatrix4(projectionMatrix)
        if (worldPoint.w <= 0) {
          return
        }

        const ndcX = worldPoint.x / worldPoint.w
        const ndcY = worldPoint.y / worldPoint.w
        if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) {
          return
        }

        const px = (ndcX * 0.5 + 0.5) * width
        const py = (-ndcY * 0.5 + 0.5) * height
        const dx = px - event.point.x
        const dy = py - event.point.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestId = track.id
        }
      })

      if (nearestId && nearestDistance <= SATELLITE_PICK_RADIUS_PX) {
        setSelectedSatelliteId(nearestId)
      }
    }

    map.on('click', onMapClick)
    return () => {
      map.off('click', onMapClick)
    }
  }, [satelliteTracks, isSatelliteActive])

  useEffect(() => {
    if (!mapRef.current || !isAircraftActive) {
      return
    }

    const map = mapRef.current
    let timerId
    let currentController

    const pullAircraft = async () => {
      if (currentController) {
        currentController.abort()
      }

      const controller = new AbortController()
      currentController = controller

      try {
        if (!documentVisibleRef.current) {
          return
        }
        const nextTracks = await fetchOpenSkyAircraft(map.getBounds(), controller.signal)
        const trimmedTracks = nextTracks.slice(0, qualityConfig.airMaxTracks)
        setAircraftTracks(trimmedTracks)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        setAircraftTracks((prev) => prev)
      }
    }

    const onMoveEnd = () => {
      void pullAircraft()
    }

    void pullAircraft()
    map.on('moveend', onMoveEnd)
    timerId = window.setInterval(() => {
      void pullAircraft()
    }, OPENSKY_REFRESH_MS)

    return () => {
      map.off('moveend', onMoveEnd)
      if (timerId) {
        window.clearInterval(timerId)
      }
      if (currentController) {
        currentController.abort()
      }
    }
  }, [isAircraftActive, qualityConfig.airMaxTracks])

  useEffect(() => {
    if (!mapRef.current || !isCameraActive) {
      return
    }

    const map = mapRef.current
    let timerId
    let currentController

    const pullCameras = async () => {
      if (currentController) {
        currentController.abort()
      }

      const controller = new AbortController()
      currentController = controller

      try {
        if (!documentVisibleRef.current) {
          return
        }
        const nextPoints = await fetchAggregatedCameras(map.getBounds(), controller.signal)
        const trimmedPoints = nextPoints.slice(0, qualityConfig.cameraMaxPoints)
        setCameraPoints(trimmedPoints)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        setCameraPoints((prev) => prev)
      }
    }

    const onMoveEnd = () => {
      void pullCameras()
    }

    void pullCameras()
    map.on('moveend', onMoveEnd)
    timerId = window.setInterval(() => {
      void pullCameras()
    }, OVERPASS_REFRESH_MS)

    return () => {
      map.off('moveend', onMoveEnd)
      if (timerId) {
        window.clearInterval(timerId)
      }
      if (currentController) {
        currentController.abort()
      }
    }
  }, [isCameraActive, qualityConfig.cameraMaxPoints])

  useEffect(() => {
    if (!mapRef.current || !isVesselActive) {
      return
    }

    const map = mapRef.current
    let timerId
    let currentController

    const pullMarine = async () => {
      if (currentController) {
        currentController.abort()
      }

      const controller = new AbortController()
      currentController = controller

      try {
        if (!documentVisibleRef.current) {
          return
        }
        const nextTracks = await fetchMarineTracks(
          map.getBounds(),
          controller.signal,
          qualityConfig.seaMaxTracks,
        )
        setMarineTracks(nextTracks)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        setMarineTracks((prev) => prev)
      }
    }

    const onMoveEnd = () => {
      void pullMarine()
    }

    void pullMarine()
    map.on('moveend', onMoveEnd)
    timerId = window.setInterval(() => {
      void pullMarine()
    }, MARINE_REFRESH_MS)

    return () => {
      map.off('moveend', onMoveEnd)
      if (timerId) {
        window.clearInterval(timerId)
      }
      if (currentController) {
        currentController.abort()
      }
    }
  }, [isVesselActive, qualityConfig.seaMaxTracks])

  useEffect(() => {
    if (!mapRef.current) {
      return
    }

    const map = mapRef.current
    if (!map.getLayer('buildings-3d')) {
      return
    }

    map.setLayoutProperty('buildings-3d', 'visibility', showBuildings3D ? 'visible' : 'none')
  }, [showBuildings3D])

  useEffect(() => {
    if (!mapRef.current || !isAircraftActive) {
      return
    }

    const map = mapRef.current
    const onMapClick = (event) => {
      if (aircraftTracks.length === 0) {
        return
      }

      let nearest = null
      let nearestDistance = Number.POSITIVE_INFINITY

      aircraftTracks.forEach((track) => {
        const projected = map.project([track.lng, track.lat])
        const dx = projected.x - event.point.x
        const dy = projected.y - event.point.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = track
        }
      })

      if (nearest && nearestDistance <= 28) {
        setSelectedFlightId(nearest.id)
      }
    }

    map.on('click', onMapClick)
    return () => {
      map.off('click', onMapClick)
    }
  }, [aircraftTracks, isAircraftActive])

  const selectedFlight = useMemo(
    () => aircraftTracks.find((track) => track.id === selectedFlightId) ?? null,
    [aircraftTracks, selectedFlightId],
  )
  const selectedSatellite = useMemo(
    () => satelliteTracks.find((track) => track.id === selectedSatelliteId) ?? null,
    [satelliteTracks, selectedSatelliteId],
  )
  const selectedCamera = useMemo(
    () => cameraPoints.find((camera) => camera.id === selectedCameraId) ?? null,
    [cameraPoints, selectedCameraId],
  )
  const selectedMarine = useMemo(
    () => marineTracks.find((track) => track.id === selectedMarineId) ?? null,
    [marineTracks, selectedMarineId],
  )
  const selectedCameraHasDirectVideo = useMemo(() => {
    const url = selectedCamera?.streamUrl
    if (!url) {
      return false
    }
    return /\.(m3u8|mp4|webm)(\?|$)/i.test(url)
  }, [selectedCamera])
  const selectedCameraPreviewUrl = useMemo(() => {
    if (!selectedCamera?.previewUrl) {
      return null
    }

    const separator = selectedCamera.previewUrl.includes('?') ? '&' : '?'
    return `${selectedCamera.previewUrl}${separator}t=${cameraPreviewTick}`
  }, [selectedCamera, cameraPreviewTick])

  const focusOnSelectedFlight = () => {
    if (!mapRef.current || !selectedFlight) {
      return
    }

    mapRef.current.easeTo({
      center: [selectedFlight.lng, selectedFlight.lat],
      zoom: Math.max(mapRef.current.getZoom(), 7.2),
      pitch: 58,
      bearing: selectedFlight.heading ?? mapRef.current.getBearing(),
      duration: 1100,
    })
  }

  const focusOnSelectedSatellite = () => {
    if (!mapRef.current || !selectedSatellite) {
      return
    }

    mapRef.current.easeTo({
      center: [selectedSatellite.lng, selectedSatellite.lat],
      zoom: Math.max(mapRef.current.getZoom(), 4.4),
      pitch: 45,
      bearing: mapRef.current.getBearing(),
      duration: 1100,
    })
  }

  useEffect(() => {
    if (!isSatelliteActive || !selectedSatelliteId) {
      setSatelliteImageryState({ status: 'idle', data: null, error: null })
      return
    }

    const selectedTrack =
      satelliteTracksRef.current.find((track) => track.id === selectedSatelliteId) ?? null
    if (!selectedTrack) {
      setSatelliteImageryState({ status: 'idle', data: null, error: null })
      return
    }

    const cacheKey = buildSatelliteImageryCacheKey(selectedTrack)
    const cached = satelliteImageryCacheRef.current.get(cacheKey)
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
      setSatelliteImageryState({ status: 'ready', data: cached.data, error: null })
      return
    }

    let controller = null
    let isCancelled = false
    setSatelliteImageryState({ status: 'loading', data: null, error: null })

    const timerId = window.setTimeout(async () => {
      controller = new AbortController()
      try {
        const imagery = await fetchLatestSatelliteImagery(selectedTrack, controller.signal)
        if (isCancelled) {
          return
        }
        if (!imagery) {
          setSatelliteImageryState({ status: 'empty', data: null, error: null })
          return
        }
        satelliteImageryCacheRef.current.set(cacheKey, {
          data: imagery,
          expiresAt: Date.now() + SATELLITE_IMAGERY_CACHE_TTL_MS,
        })
        setSatelliteImageryState({ status: 'ready', data: imagery, error: null })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        if (!isCancelled) {
          setSatelliteImageryState({
            status: 'error',
            data: null,
            error: error instanceof Error ? error.message : 'Unknown imagery error',
          })
        }
      }
    }, SATELLITE_IMAGERY_DEBOUNCE_MS)

    return () => {
      isCancelled = true
      window.clearTimeout(timerId)
      if (controller) {
        controller.abort()
      }
    }
  }, [isSatelliteActive, selectedSatelliteId])

  useEffect(() => {
    if (!isCameraActive || !selectedCamera?.previewUrl || !cameraPreviewLive) {
      return
    }
    if (!documentVisibleRef.current) {
      return
    }

    const intervalId = window.setInterval(() => {
      setCameraPreviewTick((tick) => tick + 1)
    }, qualityConfig.cameraPreviewRefreshMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isCameraActive, selectedCamera, cameraPreviewLive, qualityConfig.cameraPreviewRefreshMs])

  useEffect(() => {
    if (!isCameraActive || !selectedCameraPreviewUrl) {
      return
    }

    let isCancelled = false

    const refreshPreview = async () => {
      try {
        const response = await fetch(selectedCameraPreviewUrl, {
          cache: 'no-store',
        })
        if (!response.ok) {
          throw new Error('Camera preview fetch failed')
        }

        const blob = await response.blob()
        if (isCancelled) {
          return
        }

        const objectUrl = URL.createObjectURL(blob)
        setCameraPreviewSrc((prev) => {
          if (prev && prev.startsWith('blob:')) {
            URL.revokeObjectURL(prev)
          }
          cameraPreviewSrcRef.current = objectUrl
          return objectUrl
        })
      } catch {
        if (!isCancelled) {
          cameraPreviewSrcRef.current = selectedCameraPreviewUrl
          setCameraPreviewSrc(selectedCameraPreviewUrl)
        }
      }
    }

    void refreshPreview()

    return () => {
      isCancelled = true
    }
  }, [isCameraActive, selectedCameraPreviewUrl])

  useEffect(
    () => () => {
      const current = cameraPreviewSrcRef.current
      if (current && current.startsWith('blob:')) {
        URL.revokeObjectURL(current)
      }
    },
    [],
  )

  return (
    <section className="map-viewport" aria-label="Intel map viewport">
      <div className="map-inner" ref={mapContainerRef} />
      <div className="detail-stack">
        {isAircraftActive && selectedFlight ? (
          <aside className="flight-detail-card" aria-label="Flight details">
            <header>
              <strong>{selectedFlight.callsign}</strong>
              <span>{selectedFlight.icao24.toUpperCase()}</span>
            </header>
            <p>
              <span>HDG</span>
              <strong>{Math.round(selectedFlight.heading ?? 0)} deg</strong>
            </p>
            <p>
              <span>SPD</span>
              <strong>
                {selectedFlight.velocity ? `${Math.round(selectedFlight.velocity * 3.6)} km/h` : 'N/A'}
              </strong>
            </p>
            <p>
              <span>ALT</span>
              <strong>
                {selectedFlight.geoAltitude ? `${Math.round(selectedFlight.geoAltitude)} m` : 'N/A'}
              </strong>
            </p>
            <p>
              <span>POS</span>
              <strong>
                {selectedFlight.lat.toFixed(3)}, {selectedFlight.lng.toFixed(3)}
              </strong>
            </p>
            <p>
              <span>UPD</span>
              <strong>{new Date(selectedFlight.updatedAt * 1000).toLocaleTimeString()}</strong>
            </p>
            <button type="button" className="flight-focus-btn" onClick={focusOnSelectedFlight}>
              Flight View
            </button>
          </aside>
        ) : null}
        {isSatelliteActive && selectedSatellite ? (
          <aside className="flight-detail-card" aria-label="Satellite details">
            <header>
              <strong>{selectedSatellite.name}</strong>
              <span>{selectedSatellite.id}</span>
            </header>
            <p>
              <span>NORAD</span>
              <strong>{selectedSatellite.noradId}</strong>
            </p>
            <p>
              <span>ALT</span>
              <strong>{Math.round(selectedSatellite.altitudeKm)} km</strong>
            </p>
            <p>
              <span>SPD</span>
              <strong>
                {selectedSatellite.velocityKms
                  ? `${selectedSatellite.velocityKms.toFixed(2)} km/s`
                  : 'N/A'}
              </strong>
            </p>
            <p>
              <span>POS</span>
              <strong>
                {selectedSatellite.lat.toFixed(3)}, {selectedSatellite.lng.toFixed(3)}
              </strong>
            </p>
            <p>
              <span>UPD</span>
              <strong>{new Date(selectedSatellite.updatedAt * 1000).toLocaleTimeString()}</strong>
            </p>
            <button type="button" className="flight-focus-btn" onClick={focusOnSelectedSatellite}>
              Track View
            </button>
            <div className="sat-imagery">
              <h4>Imagery</h4>
              {satelliteImageryState.status === 'loading' ? (
                <div className="camera-preview-placeholder">Searching latest open scene...</div>
              ) : null}
              {satelliteImageryState.status === 'empty' ? (
                <div className="camera-preview-placeholder">No recent imagery for this location.</div>
              ) : null}
              {satelliteImageryState.status === 'error' ? (
                <div className="camera-preview-placeholder">
                  Imagery request failed: {satelliteImageryState.error}
                </div>
              ) : null}
              {satelliteImageryState.status === 'ready' && satelliteImageryState.data ? (
                <>
                  {satelliteImageryState.data.thumbnailUrl ? (
                    <a
                      href={satelliteImageryState.data.thumbnailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="camera-preview-link"
                    >
                      <img
                        src={satelliteImageryState.data.thumbnailUrl}
                        alt={`Satellite imagery ${satelliteImageryState.data.sceneId}`}
                        className="camera-preview-image"
                      />
                    </a>
                  ) : null}
                  <p>
                    <span>SCN</span>
                    <strong>{satelliteImageryState.data.sceneId}</strong>
                  </p>
                  <p>
                    <span>SRC</span>
                    <strong>{satelliteImageryState.data.collection}</strong>
                  </p>
                  <p>
                    <span>PLT</span>
                    <strong>{satelliteImageryState.data.platform}</strong>
                  </p>
                  <p>
                    <span>CLD</span>
                    <strong>
                      {satelliteImageryState.data.cloudCover !== null
                        ? `${satelliteImageryState.data.cloudCover.toFixed(1)}%`
                        : 'N/A'}
                    </strong>
                  </p>
                  <p>
                    <span>CAP</span>
                    <strong>
                      {satelliteImageryState.data.capturedAt
                        ? new Date(satelliteImageryState.data.capturedAt).toLocaleString()
                        : 'N/A'}
                    </strong>
                  </p>
                  {satelliteImageryState.data.sceneUrl ? (
                    <a
                      href={satelliteImageryState.data.sceneUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="camera-stream-link"
                    >
                      Open STAC scene
                    </a>
                  ) : null}
                </>
              ) : null}
            </div>
          </aside>
        ) : null}
        {isVesselActive && selectedMarine ? (
          <aside className="flight-detail-card" aria-label="Vessel details">
            <header>
              <strong>{selectedMarine.name}</strong>
              <span>{selectedMarine.id}</span>
            </header>
            <p>
              <span>MMSI</span>
              <strong>{selectedMarine.mmsi}</strong>
            </p>
            <p>
              <span>TYPE</span>
              <strong>{selectedMarine.vesselType ?? 'N/A'}</strong>
            </p>
            <p>
              <span>SPD</span>
              <strong>
                {selectedMarine.speedKnots !== null
                  ? `${selectedMarine.speedKnots.toFixed(1)} kn`
                  : 'N/A'}
              </strong>
            </p>
            <p>
              <span>HDG</span>
              <strong>
                {selectedMarine.course !== null ? `${Math.round(selectedMarine.course)} deg` : 'N/A'}
              </strong>
            </p>
            <p>
              <span>POS</span>
              <strong>
                {selectedMarine.lat.toFixed(3)}, {selectedMarine.lng.toFixed(3)}
              </strong>
            </p>
            <p>
              <span>UPD</span>
              <strong>{new Date(selectedMarine.updatedAt * 1000).toLocaleString()}</strong>
            </p>
            <p>
              <span>SRC</span>
              <strong>{selectedMarine.source}</strong>
            </p>
          </aside>
        ) : null}
        {isCameraActive && selectedCamera ? (
          <aside className="flight-detail-card" aria-label="Camera details">
          <header>
            <strong>{selectedCamera.name}</strong>
            <span>{selectedCamera.id}</span>
          </header>
          <p>
            <span>TYPE</span>
            <strong>{selectedCamera.surveillanceType ?? 'camera'}</strong>
          </p>
          <p>
            <span>OPR</span>
            <strong>{selectedCamera.operator ?? 'Unknown'}</strong>
          </p>
          <p>
            <span>SRC</span>
            <strong>{selectedCamera.source ?? 'Open data'}</strong>
          </p>
          <p>
            <span>STS</span>
            <strong>{selectedCamera.status ?? 'unknown'}</strong>
          </p>
          <p>
            <span>POS</span>
            <strong>
              {selectedCamera.lat.toFixed(3)}, {selectedCamera.lng.toFixed(3)}
            </strong>
          </p>
          <p>
            <span>UPD</span>
            <strong>{new Date(selectedCamera.updatedAt * 1000).toLocaleTimeString()}</strong>
          </p>
          {selectedCamera.streamUrl ? (
            selectedCameraHasDirectVideo ? (
              <CameraStreamPlayer
                key={selectedCamera.streamUrl}
                streamUrl={selectedCamera.streamUrl}
                name={selectedCamera.name}
              />
            ) : (
              <iframe
                title={`Live stream ${selectedCamera.name}`}
                src={selectedCamera.streamUrl}
                className="camera-stream-frame"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )
          ) : selectedCamera.previewUrl ? (
            <a
              href={selectedCamera.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="camera-preview-link"
            >
              <img
                src={cameraPreviewSrc ?? selectedCameraPreviewUrl}
                alt={`Camera preview ${selectedCamera.name}`}
                className="camera-preview-image"
              />
            </a>
          ) : (
            <div className="camera-preview-placeholder">No live preview in open-only mode</div>
          )}
          {selectedCamera.streamUrl ? (
            <a
              href={selectedCamera.streamUrl}
              target="_blank"
              rel="noreferrer"
              className="camera-stream-link"
            >
              Open provider live stream
            </a>
          ) : null}
          {selectedCamera.previewUrl ? (
            <button
              type="button"
              className="flight-focus-btn"
              onClick={() => setCameraPreviewLive((prev) => !prev)}
            >
              {cameraPreviewLive ? 'Pause Pseudo Live' : 'Resume Pseudo Live'}
            </button>
          ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  )
}

function App() {
  const [activeLayerIds, setActiveLayerIds] = useState(['aircraft'])
  const [showBuildings3D, setShowBuildings3D] = useState(true)
  const [showHighDetail3D, setShowHighDetail3D] = useState(true)

  const visibleObjects = useMemo(
    () =>
      intelObjects.filter(
        (item) =>
          activeLayerIds.includes(item.type) &&
          item.type !== 'aircraft' &&
          item.type !== 'satellite' &&
          item.type !== 'camera' &&
          item.type !== 'vessel',
      ),
    [activeLayerIds],
  )

  return (
    <div className="intel-shell">
      <aside className="side-rail" aria-label="Intel layers">
        <div className="brand">UNDER</div>
        <nav>
          {layers.map((layer) => (
            <button
              key={layer.id}
              type="button"
              aria-label={layer.label}
              title={layer.label}
              className="rail-button"
              data-active={activeLayerIds.includes(layer.id)}
              onClick={() =>
                setActiveLayerIds((prev) =>
                  prev.includes(layer.id)
                    ? prev.filter((item) => item !== layer.id)
                    : [...prev, layer.id],
                )
              }
            >
              <LayerIcon kind={layer.id} />
              <span>{layer.short}</span>
            </button>
          ))}
          <button
            type="button"
            aria-label="3D Buildings"
            title="3D Buildings"
            className="rail-button"
            data-active={showBuildings3D}
            onClick={() => setShowBuildings3D((prev) => !prev)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20V8l7-3v15z" />
              <path d="M20 20V4l-7 3v13z" />
              <path d="M11 20h2" />
            </svg>
            <span>BLD</span>
          </button>
          <button
            type="button"
            aria-label="High Detail 3D"
            title="High Detail 3D"
            className="rail-button"
            data-active={showHighDetail3D}
            onClick={() => setShowHighDetail3D((prev) => !prev)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 19V7l6-3 6 3v12" />
              <path d="M12 4v15" />
              <path d="M6 12h12" />
            </svg>
            <span>HD</span>
          </button>
        </nav>
      </aside>

      <main className="map-stage">
        <MapViewport
          objects={visibleObjects}
          activeLayerIds={activeLayerIds}
          showBuildings3D={showBuildings3D}
          showHighDetail3D={showHighDetail3D}
        />
      </main>
    </div>
  )
}

export default App
