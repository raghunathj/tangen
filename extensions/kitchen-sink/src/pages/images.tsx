import { AdminPage, Badge, MediaTile, Text } from '@/kit'
import { Example, ExampleStack, useSinkCrumbs } from './example'

/** Images & media — MediaTile + the MediaPicker field. */

// Self-contained demo images (no network, no assets): tinted SVG data URIs.
const demoImage = (hue: number, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue},45%,82%)"/><text x="200" y="158" font-family="sans-serif" font-size="20" fill="hsl(${hue},45%,35%)" text-anchor="middle">${label}</text></svg>`,
  )}`

export function SinkImagesPage() {
  return (
    <AdminPage breadcrumbs={useSinkCrumbs('Images & media')}>
      <ExampleStack>

        <Example
          title="MediaTile - ratios"
          description="Ratio-reserved box (no layout shift), object-cover fit, optional caption"
          code={`import { MediaTile } from '@/kit'

<MediaTile src={url} alt="Hero" ratio="video" caption="hero.avif · 240 KB" />
<MediaTile src={url} alt="Thumb" ratio="square" />
<MediaTile src={url} alt="Portrait" ratio="portrait" />`}
        >
          <div className="grid grid-cols-3 gap-4 items-start">
            <div className="col-span-2">
              <MediaTile src={demoImage(215, '16:9 video')} alt="16:9 demo" ratio="video" caption="hero.avif · 240 KB" />
            </div>
            <div className="space-y-3">
              <MediaTile src={demoImage(150, '1:1')} alt="square demo" ratio="square" />
            </div>
          </div>
        </Example>

        <Example
          title="Media grid with badges & selection"
          description="badges overlay top-right; onClick makes it interactive; selected draws the accent ring"
          code={`<div className="grid grid-cols-4 gap-3">
  {assets.map((a) => (
    <MediaTile
      key={a.id}
      src={a.thumbnailUrl}
      alt={a.alt}
      badges={a.storage === 's3' && <Badge variant="neutral">S3</Badge>}
      selected={a.id === selectedId}
      onClick={() => setSelectedId(a.id)}
    />
  ))}
</div>`}
        >
          <div className="grid grid-cols-4 gap-3">
            {[262, 200, 330, 45].map((hue, i) => (
              <MediaTile
                key={hue}
                src={demoImage(hue, `asset ${i + 1}`)}
                alt={`asset ${i + 1}`}
                badges={i === 0 ? <Badge variant="neutral">S3</Badge> : undefined}
                selected={i === 1}
                onClick={() => {}}
              />
            ))}
          </div>
        </Example>

        <Example
          title="MediaPicker (field)"
          description="The content-aware picker - gallery popup, folders, upload, category restrictions"
          code={`import { MediaPicker } from '@/kit'

// In a schema, prefer the field type — the editor renders the picker for you:
featuredImage: field.media({ label: 'Featured Image', config: { accept: ['image'] } })

// Standalone in a custom screen:
<MediaPicker
  value={assetId}
  onChange={setAssetId}
  accept={['image']}            // categories: image/video/audio/document/other
  mimeTypes={['image/png']}     // or exact MIME control (union with accept)
/>`}
        >
          <Text>
            The picker needs live media data, so this example stays as code - open any content
            object with a media field (e.g. page → Featured Image) to use it. Cloud and
            localization badges appear on assets automatically.
          </Text>
        </Example>

      </ExampleStack>
    </AdminPage>
  )
}
