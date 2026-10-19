using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace api_v2.Migrations
{
    /// <inheritdoc />
    public partial class AddHistoryFieldsRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Requests and Settings were made here too. They are always current, not data, so since the split
            // they belong to the state chain (Migrations/State, AdoptStateTables).
            migrationBuilder.AddColumn<string>(
                name: "Extra",
                table: "Industries",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ImportedFrom",
                table: "Industries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "LostFields",
                table: "Industries",
                type: "text[]",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Extra",
                table: "Industries");

            migrationBuilder.DropColumn(
                name: "ImportedFrom",
                table: "Industries");

            migrationBuilder.DropColumn(
                name: "LostFields",
                table: "Industries");
        }
    }
}
