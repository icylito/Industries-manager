using api_v2.Application.Ports;

namespace api_v2.Presentation.Authorization;

// The Require* endpoint filters. Route groups choose one, and the page's guards must agree with the choice.
public static class AdminExtensions
{
    private static IResult NotSignedIn() =>
        Results.Problem("Sign in to do this", statusCode: StatusCodes.Status401Unauthorized, title: "Sign in");

    private static IResult NeedsNewPassword() =>
        Results.Problem("Pick a new password first", statusCode: StatusCodes.Status403Forbidden, title: "New password needed");

    // Anyone with an account. Put on endpoints that add or change rows.
    public static TBuilder RequireSignIn<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            await user.LoadAsync(context.HttpContext.RequestAborted);
            if (!user.IsSignedIn) return NotSignedIn();
            if (user.MustChangePassword) return NeedsNewPassword();
            return await next(context);
        });
    }

    // Put on any endpoint that changes rules, history or settings
    public static TBuilder RequireAdmin<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            await user.LoadAsync(context.HttpContext.RequestAborted);
            if (!user.IsSignedIn) return NotSignedIn();
            if (user.MustChangePassword) return NeedsNewPassword();
            if (!user.IsAdmin)
            {
                return Results.Problem("Only an admin can do this", statusCode: StatusCodes.Status403Forbidden,
                    title: "Not allowed");
            }
            return await next(context);
        });
    }

    // Managers and admins: making and changing tables on the Tables page, and restoring backups
    public static TBuilder RequireManager<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            await user.LoadAsync(context.HttpContext.RequestAborted);
            if (!user.IsSignedIn) return NotSignedIn();
            if (user.MustChangePassword) return NeedsNewPassword();
            if (!user.IsManager)
            {
                return Results.Problem("Only a manager or an admin can do this", statusCode: StatusCodes.Status403Forbidden,
                    title: "Not allowed");
            }
            return await next(context);
        });
    }

    // Reading the table. Open to guests unless Auth:GuestCanView is turned off.
    public static TBuilder RequireViewer<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            if (config.GetValue("Auth:GuestCanView", true)) return await next(context);

            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            await user.LoadAsync(context.HttpContext.RequestAborted);
            if (!user.IsSignedIn) return NotSignedIn();
            return await next(context);
        });
    }
}
