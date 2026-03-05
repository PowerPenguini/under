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

    remove() {}
  }

  return {
    default: {
      Map: MockMap,
      Marker: MockMarker,
      NavigationControl: MockNavigationControl,
    },
  }
})

describe('App', () => {
  it('switches active layer from the left rail', async () => {
    const user = userEvent.setup()
    render(<App />)

    const satelliteBtn = screen.getByRole('button', { name: 'Satellites' })
    const cameraBtn = screen.getByRole('button', { name: 'Cameras' })

    expect(satelliteBtn).toHaveAttribute('data-active', 'true')

    await user.click(cameraBtn)

    expect(cameraBtn).toHaveAttribute('data-active', 'true')
    expect(satelliteBtn).not.toHaveAttribute('data-active', 'true')
  })
})
