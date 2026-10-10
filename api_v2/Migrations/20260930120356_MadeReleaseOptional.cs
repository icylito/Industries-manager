using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations
{
    /// <inheritdoc />
    public partial class MadeReleaseOptional : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<DateOnly>(
                name: "Release",
                table: "Industries",
                type: "date",
                nullable: true,
                oldClrType: typeof(DateOnly),
                oldType: "date");
        }

        /// <inheritdoc />
        // Going back leaves the release date optional. The older layout wanted a date in every row, but there is no
        // honest date for a company that has none, and filling one in would stay after going forward again. Only
        // the data travels in time, so an empty date stays empty at every step.
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
