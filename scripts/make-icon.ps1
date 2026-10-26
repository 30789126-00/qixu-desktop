Add-Type -AssemblyName System.Drawing
$size=256
$bitmap=[System.Drawing.Bitmap]::new($size,$size)
$g=[System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$path=[System.Drawing.Drawing2D.GraphicsPath]::new()
$path.AddArc(8,8,112,112,180,90)
$path.AddArc(136,8,112,112,270,90)
$path.AddArc(136,136,112,112,0,90)
$path.AddArc(8,136,112,112,90,90)
$path.CloseFigure()
$gradient=[System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Point]::new(0,8),[System.Drawing.Point]::new(0,248),[System.Drawing.Color]::FromArgb(71,151,255),[System.Drawing.Color]::FromArgb(22,97,216))
$g.FillPath($gradient,$path)
$white=[System.Drawing.Brushes]::White
$top=[System.Drawing.Point[]]@([System.Drawing.Point]::new(128,58),[System.Drawing.Point]::new(200,99),[System.Drawing.Point]::new(128,140),[System.Drawing.Point]::new(56,99))
$g.FillPolygon($white,$top)
$pen=[System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(210,255,255,255),9)
$pen.StartCap=[System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap=[System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLines($pen,[System.Drawing.Point[]]@([System.Drawing.Point]::new(56,137),[System.Drawing.Point]::new(128,178),[System.Drawing.Point]::new(200,137)))
$pen.Color=[System.Drawing.Color]::FromArgb(150,255,255,255)
$g.DrawLines($pen,[System.Drawing.Point[]]@([System.Drawing.Point]::new(56,175),[System.Drawing.Point]::new(128,216),[System.Drawing.Point]::new(200,175)))
$destination=Join-Path $PSScriptRoot '../assets'
$bitmap.Save((Join-Path $destination 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$png=[System.IO.File]::ReadAllBytes((Join-Path $destination 'icon.png'))
$stream=[System.IO.MemoryStream]::new()
$writer=[System.IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$png.Length);$writer.Write([uint32]22);$writer.Write($png)
[System.IO.File]::WriteAllBytes((Join-Path $destination 'icon.ico'),$stream.ToArray())
$writer.Dispose();$stream.Dispose();$g.Dispose();$bitmap.Dispose();$path.Dispose();$gradient.Dispose();$pen.Dispose()
Write-Output 'Generated assets/icon.png and assets/icon.ico'
