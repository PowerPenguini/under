import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

const layers = [
  { id: 'satellite', label: 'Satellites', short: 'SAT' },
  { id: 'vessel', label: 'Vessels', short: 'SEA' },
  { id: 'aircraft', label: 'Aircraft', short: 'AIR' },
  { id: 'person', label: 'Persons', short: 'HUM' },
  { id: 'camera', label: 'Cameras', short: 'CAM' },
]

const intelObjects = [
  { id: 'sat-01', type: 'satellite', lat: 53.3, lng: 17.2, level: 'low' },
  { id: 'sat-02', type: 'satellite', lat: 41.2, lng: -71.6, level: 'medium' },
  { id: 'sea-01', type: 'vessel', lat: 36.2, lng: -5.3, level: 'high' },
  { id: 'sea-02', type: 'vessel', lat: 1.3, lng: 103.8, level: 'medium' },
  { id: 'air-01', type: 'aircraft', lat: 48.9, lng: 2.4, level: 'low' },
  { id: 'air-02', type: 'aircraft', lat: 25.2, lng: 55.3, level: 'high' },
  { id: 'hum-01', type: 'person', lat: 52.2, lng: 21.0, level: 'critical' },
  { id: 'hum-02', type: 'person', lat: 51.5, lng: -0.12, level: 'medium' },
  { id: 'cam-01', type: 'camera', lat: 40.7, lng: -74.0, level: 'low' },
  { id: 'cam-02', type: 'camera', lat: 35.7, lng: 139.7, level: 'medium' },
]

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

  if (kind === 'person') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="7" r="3" />
        <path d="M6 19c0-3.5 2.5-6 6-6s6 2.5 6 6" />
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

function MapViewport({ objects }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

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
        },
        layers: [{ id: 'satellite-imagery', type: 'raster', source: 'satelliteImagery' }],
      },
      center: [15, 30],
      zoom: 1.8,
      minZoom: 1.3,
      maxZoom: 11,
      attributionControl: false,
    })

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) {
      return
    }

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    objects.forEach((item) => {
      const markerElement = document.createElement('span')
      markerElement.className = 'intel-marker'
      markerElement.dataset.level = item.level

      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat([item.lng, item.lat])
        .addTo(mapRef.current)

      markersRef.current.push(marker)
    })
  }, [objects])

  return (
    <section className="map-viewport" aria-label="Intel map viewport">
      <div className="map-inner" ref={mapContainerRef} />
    </section>
  )
}

function App() {
  const [activeLayerId, setActiveLayerId] = useState(layers[0].id)

  const visibleObjects = useMemo(
    () => intelObjects.filter((item) => item.type === activeLayerId),
    [activeLayerId],
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
              data-active={layer.id === activeLayerId}
              onClick={() => setActiveLayerId(layer.id)}
            >
              <LayerIcon kind={layer.id} />
              <span>{layer.short}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="map-stage">
        <MapViewport objects={visibleObjects} />
      </main>
    </div>
  )
}

export default App
