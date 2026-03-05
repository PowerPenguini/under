import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

vi.mock('maplibre-gl', () => {
  class MockMarker {
    setLngLat() {
      return this
    }

    addTo() {
      return this
    }

    remove() {}
  }

  class MockNavigationControl {}

  class MockMap {
    addControl() {}

    on() {}

    off() {}

    addLayer() {}

    getZoom() {
      return 2
    }

    getBounds() {
      return {
        getSouth: () => 49,
        getWest: () => 14,
        getNorth: () => 55,
        getEast: () => 24,
        getCenter: () => ({ lat: 52, lng: 19 }),
      }
    }

    setProjection() {
      return this
    }

    getLayer() {
      return {}
    }

    setLayoutProperty() {}

    isStyleLoaded() {
      return true
    }

    getCanvas() {
      return document.createElement('canvas')
    }

    triggerRepaint() {}

    easeTo() {
      return this
    }

    remove() {}
  }

  return {
    default: {
      Map: MockMap,
      Marker: MockMarker,
      NavigationControl: MockNavigationControl,
      MercatorCoordinate: {
        fromLngLat: () => ({
          x: 0,
          y: 0,
          z: 0,
          meterInMercatorCoordinateUnits: () => 1,
        }),
      },
    },
  }
})

describe('App', () => {
  it('switches active layer from the left rail', async () => {
    const user = userEvent.setup()
    render(<App />)

    const aircraftBtn = screen.getByRole('button', { name: 'Aircraft' })
    const satelliteBtn = screen.getByRole('button', { name: 'Satellites' })
    const cameraBtn = screen.getByRole('button', { name: 'Cameras' })

    expect(aircraftBtn).toHaveAttribute('data-active', 'true')
    expect(satelliteBtn).toHaveAttribute('data-active', 'false')

    await user.click(cameraBtn)

    expect(cameraBtn).toHaveAttribute('data-active', 'true')
    expect(aircraftBtn).toHaveAttribute('data-active', 'true')
  })
})
