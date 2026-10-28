import { useState } from 'react';

interface VerifiedArtworkImageProps {
  readonly objectUrl: string;
  readonly alt: string;
}

/**
 * Renders verified bytes, but still handles decode failures for unsupported or
 * corrupt image data.
 */
export function VerifiedArtworkImage({
  objectUrl,
  alt,
}: VerifiedArtworkImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <>
        <span>Artwork could not be decoded</span>
        <small>
          The stored bytes passed content verification, but the browser could
          not display this image.
        </small>
      </>
    );
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
