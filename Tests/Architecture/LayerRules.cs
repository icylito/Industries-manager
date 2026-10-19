using System.Reflection;
using System.Text.RegularExpressions;
using Xunit;

namespace api_v2.Tests.Architecture;

// The dependency rule, checked on the built assemblies. The project references already stop a layer from naming
// a project further out; these also stop it from pulling in a framework package it has no business with, which a
// project reference can't see.
public sealed class LayerRules
{
    private static readonly Assembly Domain = typeof(api_v2.Domain.Rules.Names).Assembly;
    private static readonly Assembly Application = typeof(api_v2.Application.DependencyInjection).Assembly;
    private static readonly Assembly Infrastructure = typeof(api_v2.Infrastructure.DependencyInjection).Assembly;
    private static readonly Assembly Presentation = typeof(api_v2.Presentation.DependencyInjection).Assembly;

    private static IReadOnlyList<string> Uses(Assembly assembly) =>
        assembly.GetReferencedAssemblies().Select(a => a.Name!).OrderBy(n => n).ToList();

    private static bool IsBcl(string name) => name is "netstandard" or "mscorlib" || name.StartsWith("System.", StringComparison.Ordinal)
        || name == "System";

    [Fact]
    public void The_domain_uses_nothing_but_dotnet_itself()
    {
        var outside = Uses(Domain).Where(n => !IsBcl(n)).ToList();
        Assert.True(outside.Count == 0, "Domain references: " + string.Join(", ", outside));
    }

    [Fact]
    public void The_application_uses_only_the_domain_and_the_logging_and_di_abstractions()
    {
        string[] allowed = ["api_v2.Domain", "Microsoft.Extensions.Logging.Abstractions", "Microsoft.Extensions.DependencyInjection.Abstractions"];
        var outside = Uses(Application).Where(n => !IsBcl(n) && !allowed.Contains(n)).ToList();
        Assert.True(outside.Count == 0, "Application references: " + string.Join(", ", outside));
    }

    [Fact]
    public void The_http_side_never_reaches_storage()
    {
        var wrong = Uses(Presentation)
            .Where(n => n == "api_v2.Infrastructure" || n.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal)
                || n.StartsWith("Npgsql", StringComparison.Ordinal))
            .ToList();
        Assert.True(wrong.Count == 0, "Presentation references: " + string.Join(", ", wrong));
    }

    [Fact]
    public void Infrastructure_never_reaches_the_http_side()
    {
        Assert.DoesNotContain("api_v2.Presentation", Uses(Infrastructure));
    }

    [Fact]
    public void Each_layer_keeps_its_own_namespace()
    {
        foreach (var (assembly, prefix) in new[]
                 {
                     (Domain, "api_v2.Domain"), (Application, "api_v2.Application"),
                     (Infrastructure, "api_v2.Infrastructure"), (Presentation, "api_v2.Presentation")
                 })
        {
            var strays = assembly.GetTypes()
                .Where(t => t.Namespace is not null && !t.Namespace.StartsWith(prefix, StringComparison.Ordinal)
                    && !t.Namespace.StartsWith("Microsoft", StringComparison.Ordinal) && !t.Namespace.StartsWith("System", StringComparison.Ordinal)
                    // The migrations keep the namespace they were made with, so their snapshots stay as they are
                    && !(assembly == Infrastructure && t.Namespace.StartsWith("api_v2.Migrations", StringComparison.Ordinal)))
                .Select(t => t.FullName)
                .ToList();
            Assert.True(strays.Count == 0, $"{assembly.GetName().Name} has types outside {prefix}: " + string.Join(", ", strays));
        }
    }

    // Source checks for what an assembly reference can't show: the BCL has the disk, the clock's host and the
    // network in it too, and the domain must stay pure even though it may use System.IO's Path for a file name
    [Fact]
    public void The_domain_does_no_input_or_output()
    {
        var io = new Regex(@"\b(File|Directory|FileStream|StreamReader|StreamWriter|HttpClient|Socket|Process|Environment)\s*\.|\bnew\s+(FileStream|HttpClient)\b");
        var hits = SourceFiles("Domain").SelectMany(f => File.ReadLines(f).Select((line, i) => (f, i, line)))
            .Where(x => !x.line.TrimStart().StartsWith("//", StringComparison.Ordinal) && io.IsMatch(x.line))
            .Select(x => $"{Path.GetFileName(x.f)}:{x.i + 1}: {x.line.Trim()}")
            .ToList();
        Assert.True(hits.Count == 0, "Domain does I/O:\n" + string.Join("\n", hits));
    }

    [Fact]
    public void The_application_does_no_input_or_output()
    {
        var io = new Regex(@"\b(File|Directory|FileStream|HttpClient|Process|Environment)\s*\.|\bnew\s+(FileStream|HttpClient)\b");
        var hits = SourceFiles("Application").SelectMany(f => File.ReadLines(f).Select((line, i) => (f, i, line)))
            .Where(x => !x.line.TrimStart().StartsWith("//", StringComparison.Ordinal) && io.IsMatch(x.line))
            .Select(x => $"{Path.GetFileName(x.f)}:{x.i + 1}: {x.line.Trim()}")
            .ToList();
        Assert.True(hits.Count == 0, "Application does I/O:\n" + string.Join("\n", hits));
    }

    private static IEnumerable<string> SourceFiles(string layer)
    {
        var backend = FindBackendFolder();
        return Directory.EnumerateFiles(Path.Combine(backend, layer), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar)
                && !f.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar));
    }

    private static string FindBackendFolder()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var backend = Path.Combine(dir.FullName, "backend");
            if (File.Exists(Path.Combine(backend, "Directory.Build.props")) && Directory.Exists(Path.Combine(backend, "Domain")))
            {
                return backend;
            }
        }
        throw new DirectoryNotFoundException("Couldn't find backend/ above " + AppContext.BaseDirectory);
    }
}
