// Watch the device's live position while `active` is true (ride mode). Returns
// { coords: {lat, lon, accuracy} | null, error, denied }. The watch is torn down
// whenever `active` goes false so we're not holding the GPS open (and draining
// battery) outside of an actual ride.

import { useEffect, useState } from 'react';

export function useGeolocation(active) {
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active) {
      setError(null);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('unsupported');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        setCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        // 1 = PERMISSION_DENIED. Keep any last-known coords on transient errors.
        setError(err.code === 1 ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  return { coords, error, denied: error === 'denied' };
}
