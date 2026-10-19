namespace api_v2.Application.Settings;

// The settings the use cases need from appsettings, as plain values. Program.cs reads them from configuration once
// at startup, so nothing in Application knows where a setting comes from or what its key is called.

// Wrong passwords per username: Auth:FailedTriesPerName (default 10) in Auth:FailedTriesWindowMinutes (default 15)
public sealed record LoginLimits(int FailedTriesPerName = 10, int FailedTriesWindowMinutes = 15);

// The starting retention before an admin saves one: Collector:KeepVersions and Collector:KeepDays, both optional
public sealed record RetentionDefaults(int? KeepVersions = null, int? KeepDays = null);

// The biggest backup zip the page may upload: Backup:MaxUploadMb (default 2048)
public sealed record BackupUploadLimit(int MaxUploadMb = 2048);

// Whether someone not signed in may browse: Auth:GuestCanView (default true)
public sealed record GuestAccess(bool CanView = true);
